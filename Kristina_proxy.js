'use strict';

var nodeStatic = require('node-static');
var ffmpeg = require('fluent-ffmpeg');

var http = require('http');
var https = require('https');
var fs = require('fs');
var WebSocket = require('ws').Server;
var dgram = require('dgram');
var loki = require('lokijs');

var exportFuncs = {};

//Set environment for service run
fs.access('/Users/Administrator/Desktop/NodeJS', fs.F_OK, function (err) {
  if (!err) {
    process.chdir('/Users/Administrator/Desktop/NodeJS');
    process.env.Path = process.env.Path + ";C:\\Program Files (x86)\\ffmpeg\\bin";
  }
});


var options = {
  key: fs.readFileSync('cert/ec2-52-29-254-9.key'),
  cert: fs.readFileSync('cert/ec2-52-29-254-9.crt'),
  agent: false,
  requestCert: true,
  rejectUnauthorized: false
};
var fileServer = new (nodeStatic.Server)();
var server = https.createServer(options, function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Request-Method', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  fileServer.serve(req, res);
});

/*
 Store timeline info
 Token generator
 Token checker
 API

 */
var timeline = null;
var db = new loki('loki.json', {
  autosave: true,
  autosaveInterval: 1000,
  autoload: true,
  autoloadCallback: loadHandler,
  verbose: true
});
function loadHandler(){
  timeline = db.getCollection('timeline');
  if (!timeline) {
    timeline = db.addCollection('timeline', {exact: ['start', 'end'], indices: ['start', 'end']});
  }
}

var getTimeslots = function (start, end) {
  if (timeline == null) return false;
  //Get all start/end within the range, or completely overlapping new range (start before start, end after end)
  return timeline.chain().find({
    '$or': [
      {'$and': [{'start': {'$gte': start}}, {'start': {'$lt': end}}]},
      {'$and': [{'end': {'$gt': start}}, {'end': {'$lte': end}}]},
      {'$and': [{'start': {'$lte': start}}, {'end': {'$gte': end}}]}
    ]
  }).simplesort('start').data();
};

var storeTimeslot = function (start, end, contents) {
  //put in database, Fail if it would overwrite
  if (timeline == null) return false;
  if (getTimeslots(start, end).length === 0) {
    timeline.insert({start: start, end: end, contents: contents});
    return true;
  } else {
    return false;
  }
};

var getTimeslotAt = function (time) {
  if (timeline == null) return false;

  var slot = timeline.findOne({'$and': [{'start': {'$lte': time}}, {'end': {'$gt': time}}]});
  if (slot) {
    return slot;
  }
  return false;
};

var getCurrentTimeslot = function () {
  return getTimeslotAt(new Date().getTime());
};


var deleteTimeslot = function (timeslot) {
  if (timeline == null) return false;
  timeline.chain().find({'$and': [{'start': timeslot.start}, {'end': timeslot.end}]}).remove();
};

var timelineTester = function () {
  setTimeout(function () {
    storeTimeslot(1, 5, "1-5");
    storeTimeslot(5, 7, "5-7");

    var timeslot = getTimeslotAt(6);
    deleteTimeslot(timeslot);
    storeTimeslot(6, 9, "6-9");


    console.log(getTimeslotAt(6));
    console.log(getTimeslotAt(7));
    console.log(getTimeslotAt(4.999999));
    console.log(getTimeslots(0, 10));

    var start = new Date();
    start.setHours(0);
    start.setMinutes(0);
    start.setSeconds(0);
    start.setMilliseconds(0);
    var end = new Date();
    end.setHours(24);
    end.setMinutes(0);
    end.setSeconds(0);
    end.setMilliseconds(0);
    storeTimeslot(start.getTime(), end.getTime(), "Today");
    console.log(getCurrentTimeslot());


  }, 2000);
};
//timelineTester();


//Reservation system:

//Simple GUID generator (random based, not genuine, no guarantees)
function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }

  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}


//is currently reserved?
exportFuncs.getReservation = function () {
  var timeslot = getCurrentTimeslot();
  if (timeslot) {
    return {'start': timeslot.start, 'end': timeslot.end, 'reservation': timeslot.contents};
  }
  return false;
};
//Reserve for a future timeslot?
exportFuncs.reserveFrom = function (reservation, start, duration) {
  if (!reservation || !start || !duration) {
    console.log("Incorrect parameters for reserveFrom:", reservation, start, duration);
    return false;
  }
  if (!reservation.token) {
    reservation["token"] = guid();
  }
  var end = start + duration;
  return storeTimeslot(start, end, reservation);
};
//Reserve for some time from now, returns false if blocked.
exportFuncs.reserve = function (reservation, duration) {
  var start = new Date().getTime();
  return exportFuncs.reserveFrom(reservation, start, duration);
};

//Extend reservation
exportFuncs.extend = function (reservation,duration) {
  var timeslot;
  if (reservation.start) {
    timeslot = getTimeslotAt(reservation.start);
  } else {
    timeslot = getCurrentTimeslot();
  }
  var reservation_token = reservation.token;
  if (!reservation_token && reservation.reservation) {
    reservation_token = reservation.reservation.token;
  }
  if (timeslot.contents.token && reservation_token && (timeslot.contents.token === reservation_token)) {
    deleteTimeslot(timeslot);
    storeTimeslot(timeslot.start, timeslot.end+duration, timeslot.contents);
  }
};

//Cancel further reservation
exportFuncs.cancelRest = function (reservation) {
  var timeslot;
  if (reservation.start) {
    timeslot = getTimeslotAt(reservation.start);
  } else {
    timeslot = getCurrentTimeslot();
  }
  var reservation_token = reservation.token;
  if (!reservation_token && reservation.reservation) {
    reservation_token = reservation.reservation.token;
  }
  if (timeslot.contents.token && reservation_token && (timeslot.contents.token === reservation_token)) {
    deleteTimeslot(timeslot);
    storeTimeslot(timeslot.start, new Date().getTime(), timeslot.contents);
  }
};

exportFuncs.getReservations = function (start, end) {
	console.log("getReservations:",start,end);
  var timeslots = getTimeslots(start, end);

  console.log("timeslots:",timeslots.length);
  return timeslots.map(function (timeslot) {
    return {'start': timeslot.start, 'end': timeslot.end, 'reservation': timeslot.contents};
  });
};

var getCurrentToken = function () {
  var reservation = exportFuncs.getReservation();
  if (reservation && reservation.reservation && reservation.reservation.token) {
    return reservation.reservation.token;
  }
  return false;
};

//TODO: overrule reservation!

var reservationTester = function () {
  setTimeout(function () {

    console.log(exportFuncs.reserve({}, 20000));
    var reservation = exportFuncs.getReservation();

    console.log(exportFuncs.reserveFrom({number: 2}, new Date().getTime() + 40000, 20000));
    exportFuncs.cancelRest(reservation);
    console.log(exportFuncs.getReservations());


  }, 2000);
};
// reservationTester();


var myAudioStream = new require('stream').Transform();
var myAudioBuf = [];

myAudioStream._transform = function (chunk, encoding, done) {
  if (chunk.length < 50) {
    myAudioBuf.push(chunk);
  } else {
    if (myAudioBuf.length > 0) {
      myAudioBuf.push(chunk);
      this.push(Buffer.concat(myAudioBuf));
      myAudioBuf = [];
    } else {
      this.push(chunk);
    }
  }
  done()
};

myAudioStream.on('error', function (err) {
  console.log("stream error", err);
}).on('pause', function () {
  console.log("Audio paused")
}).on('end', function () {
  console.log("Audio ended")
});

var mystream = new require('stream').Transform();
var myBuf = [];

mystream._transform = function (chunk, encoding, done) {
  if (chunk.length < 50) {
    myBuf.push(chunk);
  } else {
    if (myBuf.length > 0) {
      myBuf.push(chunk);
      this.push(Buffer.concat(myBuf));
      myBuf = [];
    } else {
      this.push(chunk);
    }
  }
  done()
};

mystream.on('error', function (err) {
  console.log("stream error", err);
}).on('pause', function () {
  console.log("paused")
}).on('end', function () {
  console.log("ended")
});

var videoCommand = ffmpeg().input(mystream)
//.inputOptions('-loglevel verbose')
  .inputOptions('-nostdin')
  .inputFormat('webm')
  .noAudio()
  .videoCodec('libx264')
  .format('mpegts')
  .fps(5)
  .outputOptions(
    '-map', '0', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-filter:v', 'fps=5', '-x264opts',
    'crf=20:vbv-bufsize=100:vbv-maxrate=3000:intra-refresh=1:slice-max-size=1500:keyint=1:scenecut=-1:ref=1')
  //  .output('udp://192.168.173.1:1111')
  .output('udp://127.0.0.1:1111')
  .on('start', function (commandLine) {
    console.log('Spawned Ffmpeg with command: ' + commandLine);
  })
  .on('progress', function (progress) {
    //console.log('Processing: ',progress);
  })
  .on('stderr', function (stderrLine) {
    //console.log('Stderr output: ' + stderrLine);
  })
  .on('codecData', function (data) {
    console.log('Input is ' + data.audio + ' audio ' +
      'with ' + data.video + ' video');
  })
  .on('end', function () {
    console.log('ffmpeg ended');
  })
  .on('error', function (error) {
    console.log('ignore ffmpeg error', error);
  });

//Spawned Ffmpeg with command: ffmpeg -loglevel verbose -f webm -i pipe:0 -acodec copy -vn -f mpegts -preset veryfast -tune zerolatency udp://127.0.0.1:2222
var audioCommand = ffmpeg().input(myAudioStream)
  //.inputOptions('-loglevel verbose')
  .inputOptions('-nostdin')
  .inputFormat('webm')
  .noVideo()
  .audioCodec('mp2')
  .format('mpegts')
  .outputOptions(
   '-map', '0', '-preset', 'veryfast', '-tune', 'zerolatency', '-ar', '16000','-ac','1')
  //  .output('udp://192.168.173.1:1111')
  .output('udp://127.0.0.1:2222')
  .on('start', function (commandLine) {
    console.log('Spawned Ffmpeg with command: ' + commandLine);
  })
  .on('progress', function (progress) {
    //console.log('Audio Processing: ',progress);
  })
  .on('stderr', function (stderrLine) {
    //console.log('Audio Stderr output: ' + stderrLine);
  }).on('codecData', function (data) {
    console.log('Input is ' + data.audio + ' audio ' +
      'with ' + data.video + ' video');
  })
  .on('end', function () {
    console.log('Audio ffmpeg ended');
  })
  .on('error', function (error) {
    console.log('ignore ffmpeg error', error);
  });

var SSICaller = function (message) {
  var client = dgram.createSocket('udp4');
  var PORT = "1338";
  var HOST = "localhost";
  client.send(message, 0, message.length, PORT, HOST, function (err, bytes) {
    if (err) throw err;
    console.log('UDP message sent to ' + HOST + ':' + PORT);
    client.close();
  });
};

var resetFFMPeg = function () {
  ////reset/close ffmpeg
  videoCommand.kill();
  audioCommand.kill();

  videoCommand.run();
  audioCommand.run();
};

//Websocket (Both audio and video):
var wss = new WebSocket({server: server});
wss.on('connection', function (ws) {
  console.log("New connection");
  var token = null;

  ws.on('error', function (error) {
    console.log("Websocket failure:", error);
  });

  ws.on('message', function (data, flags) {
	  
    if (Buffer.isBuffer(data)) {
      if (this.token === getCurrentToken()) {
        mystream.write(data);
        mystream.resume();
        myAudioStream.write(data);
        myAudioStream.resume();
      }
    } else {
		console.log("Received message",data);
      var parsed_data = JSON.parse(data);
      if (parsed_data["token"]) {
        this.token = parsed_data["token"];
      }
      if (parsed_data["target"] === "RESET"){
        if (this.token === getCurrentToken()) {
          resetFFMPeg();
        }
      }
      if (parsed_data["target"] === "PROXY") {
        var method = parsed_data["method"];
        var params = parsed_data['params'];
        if (exportFuncs[method]) {
          var res = exportFuncs[method].apply(this, params);

          ws.send(JSON.stringify({type: 'reply', method: method, result: res}));
          console.log("Handled Proxy request", parsed_data, " --> ", JSON.stringify(res));
        } else {
          console.log("Unknown Proxy request", parsed_data);
        }

      } else if (parsed_data["target"] === "VSM") {
        if (this.token === getCurrentToken()) {
          //Send message to VSM
          var options = {
            hostname: 'localhost',
            port: 11220,
            path: '/',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            }
          };

          var req = http.request(options, function (res) {
            console.log("STATUS: ${res.statusCode}");
            console.log("HEADERS: ${JSON.stringify(res.headers)}");
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
              //send chunk back to GUI:
              chunk['type']='vsm_data';
              ws.send(JSON.stringify(chunk));
            });
            res.on('end', function () {
              console.log("No more data in response.");
              ws.send(JSON.stringify({type: 'end_vsm_data'}))
            });
          });
          req.on('error', function (e) {
            console.log("problem with request: ${e.message}");
          });
          // write data to request body
          req.write(data);
          req.end();
          console.log("forwarded VSM request", parsed_data);

          if (parsed_data.arg && parsed_data.arg.val) {
            var parsed_innerdata = JSON.parse(parsed_data.arg.val);
            if (parsed_innerdata["vocapia-model"]) {
              SSICaller("vocapia language=" + parsed_innerdata["vocapia-model"]);
            }
          } else {
            console.log("Warning: parsed data didn't contain expected fields '.arg.val'!");
          }
        } else {
          console.log("Unknown data received:", data, parsed_data);
        }
      }
    }
  });

  ws.on('close', function () {
    console.log("Disconnected");
    videoCommand.kill();
    audioCommand.kill();
  });

});
server.listen(16160);
console.log("New server at port: 16160");


