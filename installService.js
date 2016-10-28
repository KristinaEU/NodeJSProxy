var Service = require('node-windows').Service;

// Create a new service object
var svc = new Service({
  name:'nodeProxy',
  description: 'A KRISTINA agent proxy service.',
  script: 'C:\\Users\\Administrator\\Desktop\\NodeJS\\Kristina_proxy.js'
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install',function(){
  svc.start();
});

//svc.uninstall();

svc.install();
