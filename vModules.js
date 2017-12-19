"use strict"

//const Settings = require('electron-settings');
var Settings = require('electron').remote.require('electron-settings')
const SerialPort = require('serialport');
const {ipcRenderer, remote} = require('electron');

var AIO8set = [0,1,2.5,4,0,0,1,2];
var AIO8actmin = [0,0,0,0,0,0,0,0];
var AIO8actmax = [5,5,5,5,5,5,5,5];
var AIO8setmin = [0,0,0,0,0,0,0,0];
var AIO8setmax = [5,5,5,5,5,5,5,5];
var AIO8names = ['Voltage1','Voltage2','Voltage3','Voltage4','Voltage5','Voltage6','Voltage7','Voltage8']
var AIO8units = ['V','V','V','V','V','V','V','V']
var AIOEnabled = [1,1,1,1,1,1,1,1];

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
    ipcRenderer.send('moduleTimedOut',uid);
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

ipcRenderer.on('changeModuleName', (event, arg) => {
    // arg = [moduleId, name]
    event.returnValue = 'ok';
    //todo: format value
    addToCommandQueue('setModuleName|'+arg[1]);
});

ipcRenderer.on('enableChanged', (event, arg) => {
    // arg = [moduleId, itemId, bool enable]
    event.returnValue = 'ok';
    //todo: format value
    var e=0; if (arg[2]) e=1;
    addToCommandQueue('setEnable|'+arg[1]+'|'+e);
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
var disconnect = 0 // 0 normally, 1 if user wants to disconnect, 2 if port was closed, 
var serialPort;

var timeoutCounter=0;
var interval=1000;

var win;
var vTimer;


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
    lastCommandSent = process.hrtime();
    if (Settings.has('defaultPollInterval.default')) interval = Settings.get('defaultPollInterval.default');
    if (Settings.has('defaultPollInterval.'+type)) interval = Settings.get('defaultPollInterval.'+type);
    if (Settings.has(uid+'.pollInterval')) interval = Settings.get(uid+'.pollInterval');
    commandQueueTimer = serialTimers(executeQueue,interval);
}





function executeQueue(){
    if (disconnect===1) {
            disconnect=2;
            commandQueueTimer.cancel();
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
    vTimer = serialTimeouts(responseParser,interval,getVirtualData(type,context,commandQueue[0]))
    commandResponseDue = true;  
    lastCommandSent = process.hrtime();
    commandQueue.shift();
    commandContext = context;
}

function getVirtualData(type,context,cmd){
    var i=0;
    var str=''
    switch(context){
        case 'setupAIOChannel':
            console.log(cmd);
            str = cmd;
            break;
        case 'setupAIChannel':
            console.log(cmd);
            str = cmd;
            break;
        case 'enableChange':
            console.log(cmd);
            str = "OK";
            break;
        case 'identify':
            var tmp = cmd.split('|');
            str = tmp[1].toString()+'|'+name+'|'+type;
            break;
        case 'init':
            if(type==='TC3'){
                for (i=0;i<3;i++)
                str=str+'#AI|'+i+'|'+(22+i/10+Math.random()/100).toString()+'|0|100|T'+i+'|C|1';
            }
            if (type==='AIO8'){
                for(i=0;i<8;i++)
                    str=str+'#AIO|'+i+'|'+(AIO8set[i]+(Math.random()-0.5)/1000).toString()+'|'+AIO8set[i].toString()+'|'+AIO8setmin[i]+'|'+AIO8setmax[i]+'|'+AIO8actmin[i]+'|'+AIO8actmax[i]+'|'+AIO8names[i]+'|'+AIO8units[i]+'|'+AIOEnabled[i]+'|';
            }
        break
        case 'getAll':
            if(type==='TC3'){
                for (i=0;i<3;i++) {
                    var value = (22+i/10+Math.random()/100);
                    str=str+'#AI|'+i+'|'+value.toString()+'|';
                }
                str=str+"#PW|"+(20+Math.random()/10).toString()+"|"+(0.5+Math.random()/100).toString()+'|';
            }
            if (type==='AIO8'){
                for(i=0;i<8;i++)
                    str=str+'#AIO|'+i+'|'+(AIO8set[i]+(Math.random()-0.5)/1000).toString()+'|'+AIO8set[i].toString()+'|';
            }
        break
        case 'setModuleName':
            var tmp = cmd.split('|');
            name = tmp[1];
            name = name.trim();
            str = name+'|OK';
        break;
        case 'setById':
            var tmp = cmd.split('|');
            AIO8set[parseInt(tmp[1])] = parseFloat(tmp[2]);
            str = 'OK';
        break;
    }
    return str;
}

//#AI|0|1442.64|#AI|1|28.77|#AI|2|1372.05|
//#AI|0|1442.64|0.00|100.00|T1|C|#AI|1|28.77|0.00|100.00|T2|C|#AI|2|1372.05|0.00|100.00|T3|C|
//#AIO|1|0.00|0.00|0.00|5.00|0.00|5.00|Voltage 1|V|#AIO|2|0.00|0.00|0.00|5.00|0.00|5.00|Voltage 2|V|#AIO|3|0.00|0.00|0.00|5.00|0.00|5.00|Voltage 3|V|#AIO|4|0.00|0.00|0.00|5.00|0.00|5.00|Voltage 4|V|#AIO|5|0.00|0.00|0.00|5.00|0.00|5.00|Voltage 5|V|#AIO|6|0.00|0.00|0.00|5.00|0.00|5.00|Voltage 6|V|#AIO|7|0.00|0.00|0.00|5.00|0.00|5.00|Voltage 7|V|#AIO|8|0.00|0.00|0.00|5.00|0.00|5.00|Voltage 8|V|
//#AIO|1|0.00099|0.00|#AIO|2|0.00114|0.00|#AIO|3|0.00130|0.00|#AIO|4|0.00175|0.00|#AIO|5|0.00168|0.00|#AIO|6|0.00175|0.00|#AIO|7|0.00160|0.00|#AIO|8|0.00168|0.00|



function addToCommandQueue(cmd){
    var index = -1;
    if (cmd.startsWith('setById')) {
        // check if another setById command is there with the same ids; if yes, replace it.
        for (var i=0;i<commandQueue.length;i++){
            if (!commandQueue[i].startsWith('setById')) continue;
            var partsFound = commandQueue[i].split('|');
            var partsNew = cmd.split('|');
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

    if (timeoutCounter<3) {
        console.log('retry')
        connect();
    }
    else {
        console.log('fatal - encountered multiple Timeouts')
        //ipcRenderer.send('moduleTimedOutFatal',[uid,comPort,name]);
    }
    ipcRenderer.send('moduleTimedOut',uid);

    isConnected = false;
    wasInitialized = false;
}


function responseParser(data){
    data = data.trim();
    commandResponseDue=false;
    timeoutCounter=0;
    switch(commandContext) {
        case 'setupAIChannel':
            var tmp = data.split('|');
            var i = tmp[1];
            TC3names[i] = tmp[2];
            TC3actmin[i] = parseFloat(tmp[3]);
            TC3actmax[i] = parseFloat(tmp[4]);
            TC3units[i] = tmp[5];
        break;
        case 'setupAIOChannel':
            var tmp = data.split('|');
            var i = tmp[1];
            AIO8names[i] = tmp[2];
            AIO8setmin[i] = parseFloat(tmp[3]);
            AIO8setmax[i] = parseFloat(tmp[4]);
            AIO8actmin[i] = parseFloat(tmp[5]);
            AIO8actmax[i] = parseFloat(tmp[6]);
            AIO8units[i] = tmp[7];
            break;
        case 'setById':
            if (data!="OK") console.log('value set was not acknowledged')
            break;
        case 'setModuleName':
            var tmp = data.split("|");
            if (tmp[1]!="OK") {console.log('setModuleName was not acknowledged'); break;}
            ipcRenderer.send('changedModuleName',[uid,tmp[0]])
            break;
        case 'init':
            //console.log(data);
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
                        var enabled=false; if(parseInt(items[10])>0) enabled=true;
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
                        ipcRenderer.send('registerItem',[items[0],uid,name,id,actValue,actMin,actMax,itemname,unit,true,true]);
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
            console.log('warning: unknown context:'+commandContext);
    }
}







/* ------------------------------------------------------------------------------------------------------------------------- */












