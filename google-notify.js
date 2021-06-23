'use strict';//
const util = require('util');
// const MediaReceiverBase = require('./lib/MediaReceiverBase');
// const DefaultMediaReceiver = require('./lib/DefaultMediaReceiver');
// const DefaultMediaReceiverAdapter = require('./lib/DefaultMediaReceiverAdapter');
// const DashCastReceiver = require('./lib/DashCastReceiver');
// const DashCastReceiverAdapter = require('./lib/DashCastReceiverAdapter');
// const GenericMediaReceiver = require('./lib/GenericMediaReceiver');
// const GenericMediaReceiverAdapter = require('./lib/GenericMediaReceiverAdapter');
// const YouTubeReceiver = require('./lib/YouTubeReceiver');
// const YouTubeReceiverAdapter = require('./lib/YouTubeReceiverAdapter');

const castV2 = require('castv2-client').Client;
const Googletts = require('google-tts-api');
const net = require('net');
const fs = require('fs');
const path = require('path');


function GoogleNotify(deviceIp, language, speakSlow, mediaServerUrl, mediaServerPort, cacheFolder, defaultVolumeLevel) {
  var notificationsQueue = [];
  var processQueueItemTimout;
  var notificationsPipeLine = [];
  var isPlayingNotifiation = false;
  const emitter = this;
  const deviceDefaultSettings = {
    "msg": { "payload": "" },
    "ip": deviceIp,
    "language": language,
    "speakSlow": speakSlow,
    "mediaServerUrl": mediaServerUrl,
    "mediaServerPort": mediaServerPort,
    "cacheFolder": cacheFolder,
    "playVolumeLevel": defaultVolumeLevel
  };

  this.stopPlaying = function (msg) {
    msg.sourceNode.node_status_ready();
    clearMessageQueue();
    isPlayingNotifiation = false;
    const devicePlaySettings = {};
    devicePlaySettings.ip = deviceDefaultSettings.ip;
    return setupDeviceCommunicationAdapter(devicePlaySettings)
      .then(devicePlaySettings =>
        setupSocket(devicePlaySettings))

      .then(devicePlaySettings =>
        connectWithDevice(devicePlaySettings, deviceIp))

      .then(devicePlaySettings =>
        setupPlayer(devicePlaySettings))

      .then(devicePlaySettings =>
        stopPlaying(devicePlaySettings))

      .then(devicePlaySettings =>
        restoreDeviceVolume(devicePlaySettings))

  };

  this.notify = function (msg, callback) {
    const devicePlaySettings = {};
    devicePlaySettings.msg = msg;
    devicePlaySettings.sourceNode = msg.sourceNode;
    devicePlaySettings.ip = deviceDefaultSettings.ip;
    devicePlaySettings.playVolumeLevel = (msg.playVolumeLevel != undefined ? msg.playVolumeLevel : deviceDefaultSettings.playVolumeLevel);
    devicePlaySettings.playVolumeLevel /= 100;
    devicePlaySettings.playMessage = (msg.playMessage != undefined ? msg.playMessage : "");
    devicePlaySettings.language = (msg.language != undefined ? msg.language : deviceDefaultSettings.language);
    devicePlaySettings.speakSlow = (msg.speakSlow != undefined ? msg.speakSlow : deviceDefaultSettings.speakSlow);
    devicePlaySettings.mediaServerUrl = (msg.mediaServerUrl != undefined ? msg.mediaServerUrl : deviceDefaultSettings.mediaServerUrl);
    devicePlaySettings.mediaServerPort = (msg.mediaServerPort != undefined ? msg.mediaServerPort : deviceDefaultSettings.mediaServerPort);
    devicePlaySettings.cacheFolder = (msg.cacheFolder != undefined ? msg.cacheFolder : deviceDefaultSettings.cacheFolder);

    if (msg.important) {
      notificationsQueue.unshift({
        'devicePlaySettings': devicePlaySettings,
        'callback': callback
      });
      notificationsQueue.forEach(notification => {
        notification.devicePlaySettings.msg.sourceNode.node_status("queued for device ready");
      })

      if (processQueueItemTimout) {
        return;
      }
      processQueueItemTimout = setTimeout(() => {
        runNotificationFromQueue();
      }, 10);

    } else {
      notificationsQueue.push({
        'devicePlaySettings': devicePlaySettings,
        'callback': callback
      });
      devicePlaySettings.msg.sourceNode.node_status("queued for device ready");
    }

    if (!isPlayingNotifiation) {
      isPlayingNotifiation = true;
      if (processQueueItemTimout) {
        return;
      }
      processQueueItemTimout = setTimeout(() => {
        runNotificationFromQueue();
      }, 10);
    }

  };

  function runNotificationFromQueue() {
    if (notificationsQueue.length) {
      const pendingNotification = notificationsQueue[0];
      runNotification(pendingNotification.devicePlaySettings)
        .then(devicePlaySettings => {
          pendingNotification.callback(null, devicePlaySettings);
          notificationsQueue.shift();
          runNotificationFromQueue();
        })
        .catch(err => {
          notificationsQueue.pop();
          pendingNotification.callback(err, pendingNotification.devicePlaySettings);
        }
        );
    }
  };

  function runNotification(devicePlaySettings) {
    return getSpeechUrl(devicePlaySettings)
      .then(devicePlaySettings =>
        playOnDevice(devicePlaySettings))
      .then(processQueueItemTimout = undefined);
  };

  // this.play = function (mp3_url, callback) {
  //   getPlayUrl(mp3_url, deviceIp, function (res) {
  //     emitter.emit("play", res)
  //   });
  // };

  function playOnDevice(devicePlaySettings) {
    return setupDeviceCommunicationAdapter(devicePlaySettings)
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

  function setupDeviceCommunicationAdapter(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.defaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
      devicePlaySettings.device = new castV2();
      devicePlaySettings.device.on('error', function (err) {
        console.log('Error: %s', err.message);
        devicePlaySettings.device.close();
        reject('error setup device communication adapter');
      });

      devicePlaySettings.device.on('status', function (status) {
        // console.log("status",status);
      });
      resolve(devicePlaySettings);
    });

  };

  function getSpeechUrl(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.msg.sourceNode.node_status("preparing voice message");
      if (devicePlaySettings.msg.hasOwnProperty('url')) {
        resolve(devicePlaySettings);
        return;
      }
      if (devicePlaySettings.cacheFolder == undefined) {
        reject("missing cache folder");
      }
      if (devicePlaySettings.msg.hasOwnProperty('mediaFileName')) {
        devicePlaySettings.mediaPlayUrl = devicePlaySettings.mediaServerUrl
          + (devicePlaySettings.mediaServerPort ? ":" + devicePlaySettings.mediaServerPort : '')
          + "/" + devicePlaySettings.mediaFileName;
        resolve('devicePlaySettings');
        return;
      }
      if (devicePlaySettings.msg.mediaUrl) {
        devicePlaySettings.mediaPlayUrl = devicePlaySettings.msg.mediaUrl;
        devicePlaySettings.mediaType = devicePlaySettings.msg.mediaType;
        resolve(devicePlaySettings);
        return;
      }

      if (!devicePlaySettings.playMessage) {
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
  };

  function createFolderIfNotExist(folderToAssert) {
    if (!fs.existsSync(folderToAssert)) {
      fs.mkdirSync(folderToAssert);
    }
    return folderToAssert;
  };

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
  };

  function connectWithDevice(devicePlaySettings, deviceIp) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.device.connect(deviceIp, () => {
        resolve(devicePlaySettings);
      });
    });
  };

  function memoriseCurrentDeviceVolume(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      if (isPlayingNotifiation) {
        resolve(devicePlaySettings); // do not memorize volume because already playing, thus not the device inital volume level setting
      }
      devicePlaySettings.device.getVolume((err, volume) => {
        deviceDefaultSettings.memoVolume = volume;
        console.log("inital vol level", volume, "device", devicePlaySettings.ip);
        resolve(devicePlaySettings);
      });
    });
  };

  function restoreDeviceVolume(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      if (deviceDefaultSettings.memoVolume == undefined) {
        resolve(devicePlaySettings)
        return;
      }
      devicePlaySettings.device.setVolume({ level: deviceDefaultSettings.memoVolume.level }, (err, response) => {
        if (err)
          reject(err);
        console.log("Vol level restored to ", deviceDefaultSettings.memoVolume.level, "device ", devicePlaySettings.ip);
        devicePlaySettings.device.close();
        devicePlaySettings.defaultMediaReceiver = null;
        isPlayingNotifiation = false;
        resolve(devicePlaySettings);
      });
    });
  };

  function setDeviceVolume(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.device.setVolume({ level: devicePlaySettings.playVolumeLevel }, (err, response) => {
        if (err)
          reject(err);
        console.log("Vol level set to ", devicePlaySettings.playVolumeLevel, "device ", devicePlaySettings.ip);
        resolve(devicePlaySettings);
      });
    });
  };

  function setupPlayer(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      devicePlaySettings.device.launch(devicePlaySettings.defaultMediaReceiver, function (err, player) {
        if (err)
          reject(error);
        devicePlaySettings.player = player;
        resolve(devicePlaySettings);
      });
    });
  };

  function playMedia(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      let previousPlayerState;
      devicePlaySettings.player.getStatus(status => {
        if (status) {
          console.log('stopping current play', status);
          devicePlaySettings.player.stop();
        }

        var media = {
          contentId: devicePlaySettings.mediaPlayUrl,
          contentType: (devicePlaySettings.mediaType ? devicePlaySettings.mediaType : 'audio/mp3'),
          streamType: (devicePlaySettings.msg.streamType ? devicePlaySettings.msg.streamType : 'BUFFERED') // or LIVE
        };

        console.log('mediaPlayUrl: ' + devicePlaySettings.mediaPlayUrl);

        devicePlaySettings.player.load(media, {
          autoplay: true
        }, function (err, status) {
          if (err) {
            console.error('media ' + devicePlaySettings.mediaPlayUrl + ' not available', err);
            reject("failed to load media, check media server in config");
          }
        });

        devicePlaySettings.sourceNode.node_status('playing voice message');

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
      })


    });
  };

  function stopPlaying(devicePlaySettings) {
    return new Promise((resolve, reject) => {
      let previousPlayerState;
      devicePlaySettings.player.getStatus(status => {
        if (status) {
          console.log('stopping current play', status);
          devicePlaySettings.player.stop();

        }
        resolve(devicePlaySettings);
      })

    });
  };

  function clearMessageQueue() {
    notificationsQueue.forEach(notification => {
      notification.devicePlaySettings.msg.sourceNode.node_status_ready();
    })
    notificationsQueue = [];
  };

};


module.exports = function (deviceip, language, speakSlow, mediaServerUrl, mediaServerPort, cacheFolder, defaultVolumeLevel) {
  if (deviceip && language) {
    return new GoogleNotify(deviceip, language, speakSlow, mediaServerUrl, mediaServerPort, cacheFolder, defaultVolumeLevel);
  }
}



