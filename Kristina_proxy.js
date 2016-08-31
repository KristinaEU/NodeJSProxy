'use strict';

process.chdir('/Users/Administrator/Desktop/NodeJS');

process.env.Path = process.env.Path + ";C:\\Program Files (x86)\\ffmpeg\\bin";
console.log(process.env.Path);

console.log("New server");
var nodeStatic = require('node-static');
var ffmpeg = require('fluent-ffmpeg');

var http = require('https');
var fs = require('fs');
var WebSocket = require('ws').Server;

var options = {
  key: fs.readFileSync('cert/ec2-52-29-254-9.key'),
  cert: fs.readFileSync('cert/ec2-52-29-254-9.crt'),
  requestCert: true,
  rejectUnauthorized: false
};
var fileServer = new(nodeStatic.Server)();
var server = http.createServer(options, function(req, res) {
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

//Video:
var mystream = new require('stream').Transform();
mystream._transform = function (chunk,encoding,done) 
{
    this.push(chunk)
    done()
}
mystream.on('error',function (err){
    console.log("stream error",err);
}).on('pause',function(){ console.log("paused")})
.on('end',function(){ console.log("ended")})
;

var command = ffmpeg().input(mystream)
  //.inputOptions('-loglevel verbose')
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
    console.log('Stderr output: ' + stderrLine);
  }).on('codecData', function(data) {
    console.log('Input is ' + data.audio + ' audio ' +
      'with ' + data.video + ' video');
  })
  .on('end',function(){
    console.log('ffmpeg ended');
  })
.run();


//Audio:
var myAudioStream = new require('stream').Transform();
myAudioStream._transform = function (chunk,encoding,done) 
{
    this.push(chunk)
    done()
}
myAudioStream.on('error',function (err){
    console.log("stream error",err);
}).on('pause',function(){ console.log("Audio paused")})
.on('end',function(){ console.log("Audio ended")})
;

//Spawned Ffmpeg with command: ffmpeg -loglevel verbose -f webm -i pipe:0 -acodec copy -vn -f mpegts -preset veryfast -tune zerolatency udp://127.0.0.1:2222
var command = ffmpeg().input(myAudioStream)
  //.inputOptions('-loglevel verbose')
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
    console.log('Audio Stderr output: ' + stderrLine);
  }).on('codecData', function(data) {
    console.log('Input is ' + data.audio + ' audio ' +
      'with ' + data.video + ' video');
  })
  .on('end',function(){
    console.log('Audio ffmpeg ended');
  })
.run();

//Websocket (Both audio and video):
var wss = new WebSocket({server:server});
wss.on('connection', function(ws){
  console.log("New connection");

  ws.on('message', function(data, flags){
    //console.log("Received data: " + data.length, flags);
    mystream.write(data);
    mystream.resume();
    myAudioStream.write(data);
    myAudioStream.resume();
	});

  ws.on('close', function(){
    console.log("Disconnected");
  });

});
server.listen(16160);

