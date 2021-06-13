'use strict';//

const castV2 = require('castv2-client').Client;
const EventEmitter = require('events');
const Googletts = require('google-tts-api');
const net = require('net');
const fs = require('fs');
const path = require('path');

function GoogleNotify(deviceIp, language, textSpeed, mediaServerIp, mediaServerPort, cacheFolder, defaultVolumeLevel) {

  const emitter = this;
  const deviceDetails = {
    "ip": deviceIp,
    "language": language,
    "textSpeed": textSpeed,
    "mediaServerIp": mediaServerIp,
    "mediaServerPortInUse": mediaServerPort,
    "cacheFolderInUse": cacheFolder,
    "playVolumeLevel": defaultVolumeLevel
  };
  setupDeviceCommunicationAdapter();

  this.notify = function (message) {
    deviceDetails.playMessage = message;
    return getSpeechUrl(deviceDetails)
      .then(deviceDetails =>
        playOnDevice(deviceDetails));
  };

  this.play = function (mp3_url, callback) {
    getPlayUrl(mp3_url, deviceIp, function (res) {
      emitter.emit("play", res)
    });
  };

  function playOnDevice(deviceDetails) {
    return setupDeviceCommunicationAdapter()
      .then(deviceDetails =>
        setupSocket(deviceDetails))

      .then(deviceDetails =>
        connectWithDevice(deviceDetails, deviceIp))

      .then(deviceDetails =>
        memoriseCurrentDeviceVolume(deviceDetails))

      .then(deviceDetails =>
        setDeviceVolume(deviceDetails))

      .then(deviceDetails =>
        setupPlayer(deviceDetails))

      .then(deviceDetails =>
        playMedia(deviceDetails))

      .then(deviceDetails =>
        restoreDeviceVolume(deviceDetails))
  };

  function setupDeviceCommunicationAdapter() {
    return new Promise((resolve, reject) => {
      deviceDetails.defaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
      deviceDetails.device = new castV2();

      deviceDetails.device.on('error', function (err) {
        console.log('Error: %s', err.message);
        deviceDetails.device.close();
        emitter.emit("error", err);
      });

      deviceDetails.device.on('status', function (status) {
        // console.log("status",status);
      });
      resolve(deviceDetails);
    });

  }

  function getSpeechUrl(deviceDetails) {
    return new Promise((resolve, reject) => {
      if (deviceDetails.cacheFolderInUse == undefined) {
        reject("missing cache folder");
      }
      const cleanedMessage = deviceDetails.playMessage.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
      deviceDetails.mediaFileName = cleanedMessage + "-" + deviceDetails.language + "-" + (deviceDetails.textSpeed != 1 ? "slow" : "normal") + ".mp3";
      let fileToCheckInCache = path.join(deviceDetails.cacheFolderInUse, deviceDetails.mediaFileName);
      deviceDetails.url = "http://" + deviceDetails.mediaServerIp + ":" + deviceDetails.mediaServerPortInUse + "/" + deviceDetails.mediaFileName;
      console.log('media url: '+deviceDetails.url);
      if (fs.existsSync(fileToCheckInCache)) {
        resolve(deviceDetails);

      } else {
        // Googletts(text, language, textSpeed).then(function (url) {
        Download_Mp3(
          deviceDetails.playMessage,
          deviceDetails.language,
          deviceDetails.mediaFileName,
          (deviceDetails.textSpeed != 1 ? true : false),
          deviceDetails.cacheFolderInUse)
          .then(_ =>
            resolve(deviceDetails))
          .catch(e =>
            { console.error(e);
              reject('failed to create the voice message');
            })
          ;
      }
    });

  };

  function getPlayUrl(url, host, callback) {
    playOnDevice(host, url, function (res) {
      callback(res);
    });
  };

  function Download_Mp3(text, language, fileNameWithSpeedAndLanguage, playSlow, cacheFolder, callback) {

    var dstFilePath = path.join(
      createFolderIfNotExist(cacheFolder), fileNameWithSpeedAndLanguage);
    // get base64 text
    return Googletts
      .getAudioBase64(text, { lang: language, slow: playSlow })
      .then((base64) => {
        // console.log({ base64 });

        // save the audio file
        const buffer = Buffer.from(base64, 'base64');
        fs.writeFileSync(dstFilePath, buffer, { encoding: 'base64' });
        callback();
      })
  }

  function createFolderIfNotExist(folderToAssert){
    if(!fs.existsSync(folderToAssert)){
      fs.mkdirSync(folderToAssert);
    }
    return folderToAssert;
  }

  function setupSocket(deviceDetails) {
    return new Promise((resolve, reject) => {
      deviceDetails.clienttcp = new net.Socket();
      deviceDetails.clienttcp.on('error', function (error) {
        reject('ERROR: Device not reachable');
      });
      deviceDetails.clienttcp.connect(8009, deviceDetails.ip, () => {
        resolve(deviceDetails);
      });
    });
  }

  function connectWithDevice(deviceDetails, deviceIp) {
    return new Promise((resolve, reject) => {
      deviceDetails.device.connect(deviceIp, () => {
        resolve(deviceDetails);
      });
    });
  }

  function memoriseCurrentDeviceVolume(deviceDetails) {
    return new Promise((resolve, reject) => {
      deviceDetails.device.getVolume((err, volume) => {
        deviceDetails.memoVolume = volume;
        console.log("inital vol level", volume, "device", deviceDetails.ip);
        resolve(deviceDetails);
      });
    });
  }

  function restoreDeviceVolume(deviceDetails) {
    return new Promise((resolve, reject) => {
      deviceDetails.device.setVolume({ level: deviceDetails.memoVolume.level }, (err, response) => {
        if (err)
          reject(err);
        console.log("Vol level restored to ", deviceDetails.memoVolume.level, "device ", deviceDetails.ip);
        deviceDetails.device.disconnect;
        resolve(deviceDetails);
      });
    });
  }

  function setDeviceVolume(deviceDetails) {
    return new Promise((resolve, reject) => {
      deviceDetails.device.setVolume({ level: deviceDetails.playVolumeLevel }, (err, response) => {
        if (err)
          reject(err);
        console.log("Vol level set to ", deviceDetails.playVolumeLevel, "device ", deviceDetails.ip);
        resolve(deviceDetails);
      });
    });
  }

  function setupPlayer(deviceDetails) {
    return new Promise((resolve, reject) => {
      deviceDetails.device.launch(deviceDetails.defaultMediaReceiver, function (err, player) {
        if (err)
          reject(error);
        deviceDetails.player = player;
        resolve(deviceDetails);
      });
    });
  }

  function playMedia(deviceDetails) {
    return new Promise((resolve, reject) => {
      var media = {
        contentId: deviceDetails.url,
        contentType: 'audio/mp3',
        streamType: 'BUFFERED' // or LIVE
      };
      let previousPlayerState;
      deviceDetails.player.load(media, {
        autoplay: true
      }, function (err, status) {
        if (err) {
          console.error('media ' +deviceDetails.url+ ' not available',  err);
          reject("failed to load media, check media server in config");
        }
      });

      emitter.emit("status", 'playing voice message');
      deviceDetails.player.on('status', function (status) {
        var currentPlayerState = status.playerState;
        console.log('status broadcast currentPlayerState=%s', currentPlayerState, "for host", deviceDetails.ip);

        if (currentPlayerState === "PAUSED") {
          resolve(deviceDetails);
        }

        const finishedPlaying = (previousPlayerState === "PLAYING" || previousPlayerState === "BUFFERING") && currentPlayerState === "IDLE";
        if (finishedPlaying) {
          resolve(deviceDetails);
        }

        previousPlayerState = currentPlayerState;

      });
    });
  }

  this.setSpeechSpeed = function (textSpeed) {
    deviceDetails.textSpeed = textSpeed;
    return this;
  }

  this.setEmitVolume = function (playVolumeLevel) {
    deviceDetails.playVolumeLevel = playVolumeLevel / 100;
    return this;
  }

};

GoogleNotify.prototype.__proto__ = EventEmitter.prototype // inherit from EventEmitter

module.exports = function (deviceip, language, speed, mediaServerIp, mediaServerPort, cacheFolder, defaultVolumeLevel) {
  if (deviceip && language) {
    if (!speed) {
      speed = 1
    };
    return new GoogleNotify(deviceip, language, speed, mediaServerIp, mediaServerPort, cacheFolder, defaultVolumeLevel);
  }
}




