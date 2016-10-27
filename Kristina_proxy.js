'use strict';

//Set environment for service run
process.chdir('/Users/Administrator/Desktop/NodeJS');
process.env.Path = process.env.Path + ";C:\\Program Files (x86)\\ffmpeg\\bin";

console.log("New server");
var nodeStatic = require('node-static');
var ffmpeg = require('fluent-ffmpeg');

var http = require('http');
var https = require('https');
var fs = require('fs');
var WebSocket = require('ws').Server;

var options = {
  key: fs.readFileSync('cert/ec2-52-29-254-9.key'),
  cert: fs.readFileSync('cert/ec2-52-29-254-9.crt'),
  agent: false,
  requestCert: true,
  rejectUnauthorized: false
};
var fileServer = new(nodeStatic.Server)();
var server = https.createServer(options, function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Request-Method', '*');
	res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
	res.setHeader('Access-Control-Allow-Headers', '*');
	if ( req.method === 'OPTIONS' ) {
		res.writeHead(200);
		res.end();
		return;
	}
	
  fileServer.serve(req, res);
})

var myAudioStream = new require('stream').Transform();
var myAudioBuf = [];
myAudioStream._transform = function (chunk,encoding,done) 
{
	if (chunk.length < 50){
	    myAudioBuf.push(chunk);
	} else {
		if (myAudioBuf.length > 0){
			myAudioBuf.push(chunk);
			this.push(Buffer.concat(myAudioBuf));
			myAudioBuf = [];	
		} else {
			this.push(chunk);	
		}
	}
    done()
}
myAudioStream.on('error',function (err){
    console.log("stream error",err);
}).on('pause',function(){ console.log("Audio paused")})
.on('end',function(){ console.log("Audio ended")})
;
var mystream = new require('stream').Transform();
var myBuf = [];
mystream._transform = function (chunk,encoding,done) 
{
    if (chunk.length < 50){
	    myBuf.push(chunk);
	} else {
		if (myBuf.length > 0){
			myBuf.push(chunk);
			this.push(Buffer.concat(myBuf));
			myBuf = [];	
		} else {
			this.push(chunk);	
		}
	}
    done()
}
mystream.on('error',function (err){
    console.log("stream error",err);
}).on('pause',function(){ console.log("paused")})
.on('end',function(){ console.log("ended")})
;

var videoCommand = ffmpeg().input(mystream)
  //.inputOptions('-loglevel verbose')
  .inputOptions('-nostdin')
  .inputFormat('webm')
  .noAudio()
  .videoCodec('libx264')
  .format('mpegts')
  .fps(5)
  .outputOptions(
  '-preset','veryfast','-tune','zerolatency',
  '-filter:v','fps=5','-x264opts',
  'crf=20:vbv-bufsize=100:vbv-maxrate=3000:intra-refresh=1:slice-max-size=1500:keyint=1:scenecut=-1:ref=1')
//  .output('udp://192.168.173.1:1111')
  .output('udp://127.0.0.1:1111')
  .on('start', function(commandLine) {
    console.log('Spawned Ffmpeg with command: ' + commandLine);
  })
 .on('progress', function(progress) {
    //console.log('Processing: ',progress);
  })
  .on('stderr', function(stderrLine) {
    //console.log('Stderr output: ' + stderrLine);
  }).on('codecData', function(data) {
    console.log('Input is ' + data.audio + ' audio ' +
      'with ' + data.video + ' video');
  })
  .on('end',function(){
    console.log('ffmpeg ended');
  })
  .on('error', function(error){
     console.log('ignore ffmpeg error',error);
  });

//Spawned Ffmpeg with command: ffmpeg -loglevel verbose -f webm -i pipe:0 -acodec copy -vn -f mpegts -preset veryfast -tune zerolatency udp://127.0.0.1:2222
var audioCommand = ffmpeg().input(myAudioStream)
  //.inputOptions('-loglevel verbose')
  .inputOptions('-nostdin')
  .inputFormat('webm')
  .noVideo()
  .audioCodec('copy')
  .format('mpegts')
  .outputOptions(
  '-preset','veryfast','-tune','zerolatency')
//  .output('udp://192.168.173.1:1111')
  .output('udp://127.0.0.1:2222')
  .on('start', function(commandLine) {
    console.log('Spawned Ffmpeg with command: ' + commandLine);
  })
 .on('progress', function(progress) {
    //console.log('Audio Processing: ',progress);
  })
  .on('stderr', function(stderrLine) {
    //console.log('Audio Stderr output: ' + stderrLine);
  }).on('codecData', function(data) {
    console.log('Input is ' + data.audio + ' audio ' +
      'with ' + data.video + ' video');
  })
  .on('end',function(){
    console.log('Audio ffmpeg ended');
  })
  .on('error', function(error){
     console.log('ignore ffmpeg error',error);
  });


//Websocket (Both audio and video):
var wss = new WebSocket({server:server});
wss.on('connection', function(ws){
  console.log("New connection");
  ////reset/close ffmpeg
  videoCommand.kill();
  audioCommand.kill();
  
  videoCommand.run();
  audioCommand.run();
    
  ws.on('message', function(data, flags){
	if (Buffer.isBuffer(data)){
      mystream.write(data);
      mystream.resume();
      myAudioStream.write(data);
      myAudioStream.resume();
    } else if (data["target"] == "VSM") {
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
		
		var req = http.request(options, (res) => {
			console.log("STATUS: ${res.statusCode}");
			console.log("HEADERS: ${JSON.stringify(res.headers)}");
			res.setEncoding('utf8');
			res.on('data', (chunk) => {
				console.log("BODY: ${chunk}");
			});
			res.on('end', () => {
				console.log("No more data in response.");
			});
		});
		req.on('error', (e) => {
			console.log("problem with request: ${e.message}");
		});
		// write data to request body
		req.write(data);
		req.end();
	}
  });

  ws.on('close', function(){
    console.log("Disconnected");
	  videoCommand.kill();
	  audioCommand.kill();
  });

});
server.listen(16160);

//Todo: Introduce a wrapping envelop around the GUI websocket data, allowing multiple streams to be handled. Specifically introduce a control stream for the VSM and SSI.


