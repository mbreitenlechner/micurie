'use strict';

var Settings = require('electron').remote.require('electron-settings')
const SerialPort = require('serialport');
const {ipcRenderer, remote} = require('electron');

function serialTimeouts(f, ms, arg) { 
    var id = setTimeout(f, ms, arg); 
    return { 
       cancel : function() { 
          clearTimeout(id); 
       } 
    }; 
}

function serialTimers(f, ms, arg) { 
    var id = setInterval(f, ms, arg); 
    return { 
       cancel : function() { 
          clearInterval(id); 
       } 
    }; 
}


ipcRenderer.on('reconnectModule', (event, arg) => {
    if (disconnect!==2) { console.log('already connected'); return; }
    disconnect = 0;
    connect();
    console.log('reconnecting',arg);
})


ipcRenderer.on('disconnectModule', (event, arg) => {
    // arg = moduleId
    event.returnValue = 'ok';

    if (disconnect!==0) { console.log('already disconnected'); return; }
    console.log('disconnecting',arg);
    commandQueue=[];
    isConnected = false;
    wasInitialized = false;
    disconnect = 1;
});


ipcRenderer.on('changeSetValueFromMain', (event, arg) => {
    console.log('changed Setvalue')
    // arg = [moduleId, itemId, value]
    event.returnValue = 'ok';
    //todo: format value
    addToCommandQueue('setById|'+arg[1]+'|'+arg[2].toString());
});

ipcRenderer.on('enableChanged', (event, arg) => {
    // arg = [moduleId, itemId, bool enable]
    event.returnValue = 'ok';
    //todo: format value
    var e=0; if (arg[2]) e=1;
    addToCommandQueue('setEnable|'+arg[1]+'|'+e);
});


ipcRenderer.on('changeModuleName', (event, arg) => {
    // arg = [itemId, float: value]
    event.returnValue = 'ok';
    //todo: format value
    addToCommandQueue('setModuleName|'+arg[1]);
});

ipcRenderer.on('changeModuleSettings', (event, arg) => {
    // arg = [moduleId, pollinterval]
    console.log('changed Interval',arg[1])
    event.returnValue = 'ok';
    commandQueueTimer.cancel();
    commandQueueTimer = serialTimers(executeQueue,arg[1])
});

ipcRenderer.on('setupAIOChannel', (event, arg) => {
    //args = {moduleId, itemId, name, setmin, setmax, actmin, actmax, unit]
    console.log('setupAIOChannel',arg)
    event.returnValue = 'ok';
    addToCommandQueue('setupAIOChannel|'+arg[1]+'|'+arg[2]+'|'+arg[3]+'|'+arg[4]+'|'+arg[5]+'|'+arg[6]+'|'+arg[7]);
    addToCommandQueue('init'); 
});

ipcRenderer.on('setupAIChannel', (event, arg) => {
    //args = {moduleId, itemId, name, actmin, actmax, unit]
    console.log('setupAIOChannel',arg)
    event.returnValue = 'ok';
    addToCommandQueue('setupAIChannel|'+arg[1]+'|'+arg[2]+'|'+arg[3]+'|'+arg[4]+'|'+arg[5]);
    addToCommandQueue('init'); 
});

//var console = {};
//console.log = function(){};

var uid=0;
var name = '';
var comPort = '';
var type = '';
var protocolVersion = '';
var firmwareVersion = '';
var isConnected = false;
var wasInitialized =false;
var commandQueue = [];
var commandResponseDue = false;
var commandContext = '';
var lastCommandSent;
var commandQueueTimer;
var disconnect = 0 // 0 normally, 1 if user wants to disconnect, 2 if port was closed, 3 if user wants to reconnect
var serialPort;

var timeoutCounter=0;
var interval=1000;

var win;

document.onreadystatechange = function () {
    if (document.readyState == "complete") {
        init();
        ipcRenderer.send('getModuleInfo'); 
    }
}



function init() {
    win = remote.getCurrentWindow();
    var args = win.getTitle().split('|');
    console.log(args);
    comPort = args[1];
    uid = args[2];
    name = args[3];
    type = args[4];
    protocolVersion = args[5];
    firmwareVersion = args[6];
    connect();
}

function connect(){
    serialPort = new SerialPort(comPort,{baudRate:115200, parser: SerialPort.parsers.readline('\n')},function(err){
        if (err) {
            ipcRenderer.send('addLog',['[140] Error creating port '+comPort+': '+err.message,'System','Error']);
            ipcRenderer.send('moduleTimedOutFatal',[uid, comPort, name]);
            return console.log(err.message);
        }
        lastCommandSent = process.hrtime();
        if (Settings.has('defaultPollInterval.default')) interval = Settings.get('defaultPollInterval.default');
        if (Settings.has('defaultPollInterval.'+type)) interval = Settings.get('defaultPollInterval.'+type);
        if (Settings.has(uid+'.pollInterval')) interval = Settings.get(uid+'.pollInterval');
        commandQueueTimer = serialTimers(executeQueue,interval);
    });

    serialPort.on('data', function(data){
         responseParser(data);
     });
 

}





function executeQueue(){
    if (disconnect===1) {
        serialPort.close( function(err) {
            if (err) { 
                ipcRenderer.send('addLog',['[166] Error closing port '+comPort+': '+err.message,'System','Error']);
                return console.log('disconnect: ',err.message);
            }
            disconnect=2;
            commandQueueTimer.cancel();
            ipcRenderer.send('moduleTimedOut',[uid,comPort,name]);            
        });
        return;
    }
    
    if (disconnect>0) return;
    if (isConnected===false && wasInitialized===true) return;
    
    var tmp = process.hrtime(lastCommandSent);
    var dt = tmp[0]+tmp[1]/1e9;



    if ((commandResponseDue===true && dt>0.25) || dt>(0.25+interval/1000)){
        timeoutHandler();
        return;
    }
    
    if (commandResponseDue===true) return;

    if (wasInitialized===false) addToCommandQueue('init');
    if (commandQueue.length===0) addToCommandQueue('getAll');
    
    var context = commandQueue[0];
    if (context.indexOf('|')>=0) context=context.substring(0,context.indexOf('|'));
    
    serialPort.write(commandQueue[0]+'\n', function(err) {
        if (err) {
            ipcRenderer.send('addLog',['[199] Error writing "'+commandQueue[0]+'" to port '+comPort+': '+err.message,'System','Error']);
            console.log('error writing',err.message)
            isConnected=false;
            timeoutHandler();
            return;
        }
        commandResponseDue = true;  
        lastCommandSent = process.hrtime();
    });
    commandQueue.shift();
    commandContext = context;
}




function addToCommandQueue(cmd){
    var index = -1;
    if (cmd.startsWith('setById')) {
        // check if another setById command is there with the same ids; if yes, replace it.
        for (var i=0;i<commandQueue.length;i++){
            if (!commandQueue[i].startsWith('setById')) continue;
            var partsFound = commandQueue[i].split(' ');
            var partsNew = cmd.split(' ');
            if (partsFound[0]==partsNew[0] && partsFound[1]==partsNew[1]) index=i;
        }
    }
    if (index>=0)
        commandQueue[index] = cmd;
    else 
        commandQueue.push(cmd); // add cmd at end of queue
}



function timeoutHandler(){
    console.log('Timeout: Module ',name,' on port ',comPort);
    timeoutCounter++;
    
    commandQueue=[];
    commandContext='';
    commandResponseDue=false;
    commandQueueTimer.cancel();    
    serialPort.close(function(err) {
        
        if (err) { 
            ipcRenderer.send('addLog',['[245] Error closing port '+comPort+': '+err.message,'System','Error']);
            // fatal: close process
            console.log('fatal');
            ipcRenderer.send('moduleTimedOutFatal',[uid,comPort,name]);
            return console.log('closing:',err.message); 
        } else {
            isConnected = false;
            wasInitialized = false;
            if (timeoutCounter<3) {
                console.log('retry')
                ipcRenderer.send('addLog',['[253] Retry '+comPort,'System','Warning']);
                connect();
            }
            else {
                ipcRenderer.send('addLog',['[257] Encountered multiple Timeouts '+comPort,'System','Warning']);
                console.log('fatal - encountered multiple Timeouts')
                ipcRenderer.send('moduleTimedOutFatal',[uid,comPort,name]);
            }
            ipcRenderer.send('moduleTimedOut',[uid,comPort,name]);
        

        }

    });


}


function responseParser(data){
    data = data.trim();
    commandResponseDue=false;
    timeoutCounter=0;
    switch(commandContext) {
        case 'setupAIOChannel':
            if (data!=="OK") console.log('setup AIO channel was not acknowledged')
            break;
        case 'setById':
            if (data!=="OK") console.log('value set was not acknowledged')
            break;
        case 'setModuleName':
            var tmp = data.split("|");
            if (tmp[1]!="OK") {console.log('setModuleName was not acknowledged'); break;}
            ipcRenderer.send('changedModuleName',[uid,tmp[0]])            
            break;
        case 'init':
            console.log(data);
            if (data.startsWith("#")) data=data.substring(1,data.length-1);
            var values = data.split("#");
            for (var i=0;i<values.length;i++){
                items = values[i].split("|");
                switch(items[0]){
                    case 'AIO':
                        var id = items[1];
                        var actValue = parseFloat(items[2]);
                        var setValue = parseFloat(items[3]);
                        var setMin = parseFloat(items[4]);
                        var setMax = parseFloat(items[5]);
                        var actMin = parseFloat(items[6]);
                        var actMax = parseFloat(items[7]);
                        var itemname = items[8].replace(/([^_a-z0-9]+)/gi, '-');
                        var unit = items[9];
                        var enabled=false; if (parseInt(items[10])>0) enabled=true;
                        if (enabled===false) actValue='NaN';
                        ipcRenderer.send('registerItem',[items[0],uid,name,id,actValue,setValue,setMin,setMax,actMin,actMax,itemname,unit,true,enabled])
                        // moved to main: defaultSettings.add(Modules[index].uniqueID,id,'recordValue',true);
                        break;
                    case 'AI':
                        var id = items[1];
                        var actValue = parseFloat(items[2]);
                        var actMin = parseFloat(items[3]);
                        var actMax = parseFloat(items[4]);
                        var itemname = items[5].replace(/([^_a-z0-9]+)/gi, '-');
                        var unit = items[6];
                        ipcRenderer.send('registerItem',[items[0],uid,name,id,actValue,actMin,actMax,itemname,unit,true, true]);
                        //defaultSettings.add(Modules[index].uniqueID,id,'recordValue',true);                        
                        break;  
                    }
            }

            //moved to main: defaultSettings.setModuleSettings(Modules[index]);
            wasInitialized=true;
            isConnected=true;
            lastCommandSent = process.hrtime();
            break;
        case 'getAll':
            if (data.startsWith("#")) data=data.substring(1,data.length-1);
            var values = data.split("#");
            var dataCollection = [];
            for (var i=0;i<values.length;i++){
                var items = values[i].split("|");
                switch(items[0]){
                    case 'AIO':
                        dataCollection.push([uid,items[1],'actValue',parseFloat(items[2])]);
                        //dataCollection.push([uid,items[1],'setValue',parseFloat(items[4])]);
                    break;
                    case 'AI':
                        dataCollection.push([uid,items[1],'actValue',parseFloat(items[2])]);
                    break;
                    case 'PW':
                        dataCollection.push([uid,null,'extVoltage',parseFloat(items[1])]);
                        dataCollection.push([uid,null,'extCurrent',parseFloat(items[2])]);
                    break;
                }
            }
            ipcRenderer.send('updateData',dataCollection);
            //console.log('Data came in from ',name,type);
            break;
        default:
            ipcRenderer.send('addLog',['[343] Warning: unknown context '+comPort+': "'+data+'"','System','Warning']);
            console.log('('+comPort+') Error: unknown context:'+commandContext);
    }
}







/* ------------------------------------------------------------------------------------------------------------------------- */







