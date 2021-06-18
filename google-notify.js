'use strict';//

const castV2 = require('castv2-client').Client;
const EventEmitter = require('events');
const Googletts = require('google-tts-api');
const net = require('net');
const fs = require('fs');
const path = require('path');


function GoogleNotify(deviceIp, language, speakSlow, mediaServerUrl, mediaServerPort, cacheFolder, defaultVolumeLevel) {
  var notificationsPipeLine = [];
  var isPlayingNotifiation = false;
  const emitter = this;
  const deviceDefaultSettings = {
    "msg": {"payload":""},
    "ip": deviceIp,
    "language": language,
    "speakSlow": speakSlow,
    "mediaServerUrl": mediaServerUrl,
    "mediaServerPort": mediaServerPort,
    "cacheFolder": cacheFolder,
    "playVolumeLevel": defaultVolumeLevel
  };
  const devicePlaySettings={};

  setupDeviceCommunicationAdapter();

  this.notify = function (msg) {
    devicePlaySettings.msg = msg;
    devicePlaySettings.ip = deviceDefaultSettings.ip;
    devicePlaySettings.playVolumeLevel = (msg.playVolumeLevel!=undefined?msg.playVolumeLevel:deviceDefaultSettings.playVolumeLevel);
    devicePlaySettings.playVolumeLevel /=100;
    devicePlaySettings.playMessage = (msg.playMessage!=undefined?msg.playMessage:"");
    devicePlaySettings.language = (msg.language!=undefined?msg.language:deviceDefaultSettings.language);
    devicePlaySettings.speakSlow = (msg.speakSlow!=undefined?msg.speakSlow:deviceDefaultSettings.speakSlow);
    devicePlaySettings.mediaServerUrl = (msg.mediaServerUrl!=undefined?msg.mediaServerUrl:deviceDefaultSettings.mediaServerUrl);
    devicePlaySettings.mediaServerPort = (msg.mediaServerPort!=undefined?msg.mediaServerPort:deviceDefaultSettings.mediaServerPort);
    devicePlaySettings.cacheFolder = (msg.cacheFolder!=undefined?msg.cacheFolder:deviceDefaultSettings.cacheFolder);
    return getSpeechUrl(devicePlaySettings)
      .then(devicePlaySettings =>
        playOnDevice(devicePlaySettings));
  };

  this.play = function (mp3_url, callback) {
    getPlayUrl(mp3_url, deviceIp, function (res) {
      emitter.emit("play", res)
    });
  };

  function playOnDevice(devicePlaySettings) {
    return setupDeviceCommunicationAdapter()
      .then(devicePlaySettings =>
        setupSocket(devicePlaySettings))

      .then(devicePlaySettings =>
        connectWithDevice(devicePlaySettings, deviceIp))

      .then(devicePlaySettings =>
        memoriseCurrentDeviceVolume(devicePlaySettings))

      .then(devicePlaySettings =>
        setDeviceVolume(devicePlaySettings))

      .then(devicePlaySettings =>
        setupPlayer(devicePlaySettings))

      .then(devicePlaySettings =>
        playMedia(devicePlaySettings))

      .then(devicePlaySettings =>
        restoreDeviceVolume(devicePlaySettings))
  };

  function setupDeviceCommunicationAdapter() {
    return new Promise((resolve, reject) => {
      devicePlaySettings.defaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
      devicePlaySettings.device = new castV2();

      devicePlaySettings.device.on('error', function (err) {
        console.log('Error: %s', err.message);
        devicePlaySettings.device.close();
        emitter.emit("error", err);
      });

      devicePlaySettings.device.on('status', function (status) {
        // console.log("status",status);
      });
      resolve(devicePlaySettings);
    });

  }

  function getSpeechUrl(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      if(devicePlaySettings.msg.hasOwnProperty('url')){
        resolve(devicePlaySettings);
        return;
      }
      if (devicePlaySettings.cacheFolder == undefined) {
        reject("missing cache folder");
      }
      if (devicePlaySettings.msg.hasOwnProperty('mediaFileName')){
        devicePlaySettings.mediaPlayUrl = devicePlaySettings.mediaServerUrl
        + (devicePlaySettings.mediaServerPort?":" + devicePlaySettings.mediaServerPort:'')
        + "/" + devicePlaySettings.mediaFileName;
        resolve('devicePlaySettings');
        return;
      }
      if (devicePlaySettings.msg.mediaUrl){
        devicePlaySettings.mediaPlayUrl = devicePlaySettings.msg.mediaUrl;
        resolve('devicePlaySettings');
        return;
      }

      if (!devicePlaySettings.playMessage){
        reject('missing message to play');
        return;
      }
      const cleanedMessage = devicePlaySettings.playMessage.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
      devicePlaySettings.mediaFileName = cleanedMessage + "-" 
        + devicePlaySettings.language + "-" 
        + (devicePlaySettings.speakSlow ? "slow" : "normal") 
        + ".mp3";
      let fileToCheckInCache = path.join(devicePlaySettings.cacheFolder, devicePlaySettings.mediaFileName);
      devicePlaySettings.mediaPlayUrl = devicePlaySettings.mediaServerUrl
        + ":" + devicePlaySettings.mediaServerPort
        + "/" + devicePlaySettings.mediaFileName;
      
      if (fs.existsSync(fileToCheckInCache)) {
        resolve(devicePlaySettings);

      } else {
        Download_Mp3(
          devicePlaySettings.playMessage,
          devicePlaySettings.language,
          devicePlaySettings.mediaFileName,
          devicePlaySettings.speakSlow,
          devicePlaySettings.cacheFolder)
          .then(_ =>
            resolve(devicePlaySettings))
          .catch(e => {
            console.error(e);
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

  function Download_Mp3(text, language, fileNameWithSpeedAndLanguage, speakSlow, cacheFolder) {

    var dstFilePath = path.join(
      createFolderIfNotExist(cacheFolder), fileNameWithSpeedAndLanguage);
    // get base64 text
    return Googletts
      .getAudioBase64(text, { lang: language, slow: speakSlow })
      .then((base64) => {
        // console.log({ base64 });

        // save the audio file
        const buffer = Buffer.from(base64, 'base64');
        fs.writeFileSync(dstFilePath, buffer, { encoding: 'base64' });
      })
  }

  function createFolderIfNotExist(folderToAssert) {
    if (!fs.existsSync(folderToAssert)) {
      fs.mkdirSync(folderToAssert);
    }
    return folderToAssert;
  }

  function setupSocket(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.clienttcp = new net.Socket();
      devicePlaySettings.clienttcp.on('error', function (error) {
        reject('ERROR: Device not reachable');
      });
      devicePlaySettings.clienttcp.connect(8009, devicePlaySettings.ip, () => {
        resolve(devicePlaySettings);
      });
    });
  }

  function connectWithDevice(devicePlaySettings, deviceIp) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.device.connect(deviceIp, () => {
        resolve(devicePlaySettings);
      });
    });
  }

  function memoriseCurrentDeviceVolume(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.device.getVolume((err, volume) => {
        devicePlaySettings.memoVolume = volume;
        console.log("inital vol level", volume, "device", devicePlaySettings.ip);
        resolve(devicePlaySettings);
      });
    });
  }

  function restoreDeviceVolume(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.device.setVolume({ level: devicePlaySettings.memoVolume.level }, (err, response) => {
        if (err)
          reject(err);
        console.log("Vol level restored to ", devicePlaySettings.memoVolume.level, "device ", devicePlaySettings.ip);
        devicePlaySettings.device.close();
        devicePlaySettings.defaultMediaReceiver=null;
        isPlayingNotifiation=false;
        resolve(devicePlaySettings);
      });
    });
  }

  function setDeviceVolume(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.device.setVolume({ level: devicePlaySettings.playVolumeLevel }, (err, response) => {
        if (err)
          reject(err);
        console.log("Vol level set to ", devicePlaySettings.playVolumeLevel, "device ", devicePlaySettings.ip);
        resolve(devicePlaySettings);
      });
    });
  }

  function setupPlayer(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.device.launch(devicePlaySettings.defaultMediaReceiver, function (err, player) {
        if (err)
          reject(error);
        devicePlaySettings.player = player;
        resolve(devicePlaySettings);
      });
    });
  }

  function playMedia(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      let previousPlayerState;

      var media = {
        contentId: devicePlaySettings.mediaPlayUrl,
        contentType: (devicePlaySettings.msg.contentType?devicePlaySettings.msg.contentType:'audio/mp3'),
        streamType: (devicePlaySettings.msg.streamType?devicePlaySettings.msg.streamType:'BUFFERED') // or LIVE
      };

      console.log('mediaPlayUrl: ' + devicePlaySettings.mediaPlayUrl);

      isPlayingNotifiation=true;
      devicePlaySettings.player.load(media, {
        autoplay: true
      }, function (err, status) {
        if (err) {
          console.error('media ' + devicePlaySettings.mediaPlayUrl + ' not available', err);
          reject("failed to load media, check media server in config");
        }
      });

      emitter.emit("status", 'playing voice message');
      devicePlaySettings.player.on('status', function (status) {
        var currentPlayerState = status.playerState;
        console.log('status broadcast currentPlayerState=%s', currentPlayerState, "for host", devicePlaySettings.ip);

        if (currentPlayerState === "PAUSED") {
          resolve(devicePlaySettings);
        }

        const finishedPlaying = (previousPlayerState === "PLAYING" || previousPlayerState === "BUFFERING") && currentPlayerState === "IDLE";
        if (finishedPlaying) {
          resolve(devicePlaySettings);
        }

        previousPlayerState = currentPlayerState;

      });
    });
  }

};

GoogleNotify.prototype.__proto__ = EventEmitter.prototype // inherit from EventEmitter

module.exports = function (deviceip, language, speakSlow, mediaServerUrl, mediaServerPort, cacheFolder, defaultVolumeLevel) {
  if (deviceip && language) {
    return new GoogleNotify(deviceip, language, speakSlow, mediaServerUrl, mediaServerPort, cacheFolder, defaultVolumeLevel);
  }
}




