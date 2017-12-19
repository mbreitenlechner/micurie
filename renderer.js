"use strict"

var Settings = require('electron').remote.require('electron-settings')
const {BrowserWindow} = require('electron').remote;
const path = require('path');
const url = require('url');
const fs = require('fs');
const {ipcRenderer, remote} = require('electron');
const {dialog} = require('electron').remote;
const SerialPort = require('serialport');
const striptags = require('striptags');
var dataManager = require('./dataManager').data;

var Modules = [];
var virtuals = true;        // activate two virtual modules

var scriptIds = [];         // Ids which match the scriptObj in main.js
var scriptCodes = [];       // String containing the code
var scriptNames = [];       // names (filenames)


var logMsg = [];
var logType = [];
var logOrigin = [];
var logTst = [];
var lastLogMsg='';
var lastLogType='';

window.setInterval(displayUpdate, Settings.get('displayUpdateInterval'));

window.addEventListener('unload',(event) => {
    Settings.set('Window.x',window.screenX);
    Settings.set('Window.y',window.screenY);
    var mids = getDockedModuleIds();
    for (var i=0;i<mids.length;i++) {
        if (document.getElementById(mids[i]).firstChild.hasAttribute('expanded'))
            Settings.set(mids[i]+'.display',1);
        else
            Settings.set(mids[i]+'.display',0);
    }
})


var serialCheckTimeout = myTimeouts(startCheckingForSerialports,500);
function myTimeouts(f, ms, arg) { 
    var id = setTimeout(f, ms, arg); 
    return { 
       cancel : function() { 
          clearTimeout(id); 
       } 
    }; 
}

function openAppSettings(what){
    ipcRenderer.send('openAppSettings',what);
}

function toggleLogDisplay(){
    if (document.getElementById('log-display').style.display==='none'){
        document.getElementById('log-display').style.removeProperty('display');
        document.getElementById('btn-show-logs').firstChild.setAttribute('name','keyboard-arrow-down');
    } else {
        document.getElementById('log-display').style.setProperty('display','none');
        document.getElementById('btn-show-logs').firstChild.setAttribute('name','keyboard-arrow-up');
    }
}

function status(txt){
    if (txt===''){
        document.getElementById('logText').innerHTML = lastLogMsg;
    } else {
        lastLogMsg = document.getElementById('logText').innerHTML;
        document.getElementById('logText').innerHTML = txt;
    }
    //document.getElementById('statusText').innerHTML=txt;
}

function appendToLogfile(msg,origin,type,dateObj){
    var loggerMsg = striptags(msg);
    if (type==="ScriptLog") loggerMsg = loggerMsg.substr(loggerMsg.indexOf(':')+2,loggerMsg.length-1);

    var minutes = dateObj.getTimezoneOffset(); // that's in minutes
    var t2 = dateObj.valueOf()-minutes*60000; // micoseconds from 1970, corrected by time zone offset
    var t3 = new Date(t2);
    var timeString = t3.toISOString();
    timeString = timeString.replace(/[TZ]/g,' ');
    timeString = timeString.substr(0,timeString.lastIndexOf('.'))
    
    var spaces1 = ''; for (var i=0;i<12-origin.length;i++) spaces1+=' ';
    var spaces2 = ''; for (var i=0;i<12-type.length;i++) spaces2+=' ';
    
    var line = timeString+'    '+origin+spaces1+type+spaces2+loggerMsg+'\n';

    if (loggerMsg==='Application started') line = '\n-----------------------------------------------------------------------------\n\n'+line;

    var logFile = path.join(Settings.get('logFolder'),Settings.get('logFile'));

    fs.appendFile(logFile, line, function (err) {
        if (err) {
            console.log(line,' appending failed')
        } 
      })

    //console.log(line);
}
 
function addLog(msg,origin,type){
    if (msg===null) msg='null';
    if (msg===undefined) msg='undefined';
    msg = msg.toString();
    origin = origin.toString();
    type=type.toString();
    if (type==='') type = 'Info';
    if (type==='Error'){
        msg = '<span style="color: red">'+msg+'</span>';
        if (msg.startsWith('Error:')) msg = msg.substr(6).trim();
        }
    if (type==='Warning'){
        msg = '<span style="color: rgb(211, 108, 12)">'+msg+'</span>';
        if (msg.startsWith('Warning:')) msg = msg.substr(8).trim();
    }

    lastLogMsg = msg;
    logMsg.push(msg);
    logType.push(type);
    logOrigin.push(origin);

    var d = new Date();
    appendToLogfile(msg,origin,type,d);
    logTst.push(d);
    if (logMsg.length>100){
        logMsg.shift();
        logOrigin.shift();
        logType.shift();
        logTst.shift();
    }

    var html = '';
    for (var i=0;i<logMsg.length;i++){
        html=html+'<br><span title="'+logType[i]+'">'+logTst[i].toTimeString().substring(0,8)+': '+logMsg[i]+'</span>';
    }
    if (html==='') html = 'no messages';
    var obj = document.getElementById('log-display');
    obj.innerHTML=html.substr(4);
    obj.scrollTop = obj.scrollHeight;
    
    var lastIndex = logMsg.length-1;
    if (lastIndex>=0) document.getElementById('logText').innerHTML = logTst[lastIndex].toTimeString().substring(0,8)+': '+logMsg[lastIndex];



    // relay to recorder:
    var recorderMsg = striptags(msg);
    if (type==="UserScript") recorderMsg = recorderMsg.substr(recorderMsg.indexOf(':')+2,recorderMsg.length-1);
    ipcRenderer.send('addRecorderEvent',[recorderMsg,type]);
}

ipcRenderer.on('addLog', (event, args) => { 
    // args = [msg, origin, type]
    event.returnValue = 'ok';
    addLog(args[0],args[1],args[2]);
});

window.addEventListener("maximize", function (e) {
    Settings.set('Window.isMaximized',1);
});
window.addEventListener("unmaximize", function (e) {
    Settings.set('Window.isMaximized',0);
});

window.addEventListener("resize", function (e) {
    Settings.set('Window.width',window.outerWidth);
    Settings.set('Window.height',window.outerHeight);
    document.getElementById('MainContainer').style.height = (window.outerHeight-62-24)+'px';
    document.getElementById('bodyDiv').style.height = (window.outerHeight-62-24)+'px';
});


ipcRenderer.on('scriptLoadsSetpoints', (event, arg) => { // from a scriptRunner via main
    // arg = [filename, path, scriptId]
    console.log('script loads setpoints:',arg);
    var fn = path.join(arg[1],arg[0]);
    fs.readFile(fn, (err, data) => {
        if (err) { 
            console.log(err); addLog(err,'Script','Error');
            ipcRenderer.send('setpointsLoaded',false)
        } else {
            ipcRenderer.send('setpointsLoaded',parseAndSetSetpoints(data,'Script'))
        }
    });
});

function loadSetpoints(){
    console.log('load Setpoints')
    dialog.showOpenDialog({filters: [{extensions: ['set']}], defaultPath: Settings.get('setpointFolder'), title:'Load setpoints'}, function(filename){
        if (filename === undefined) return;
        fs.readFile(filename[0], (err, data) => {
            if (err) { console.log(err); addLog(err,'System','Error'); return}
            parseAndSetSetpoints(data,'User');
            Settings.set('setpointFolder',path.dirname(filename[0]));
        });
    });
}


ipcRenderer.on('scriptSavesSetpoints', (event, arg) => { // from a scriptRunner via main
    // arg = [filename, path, scriptId]
    console.log('script saves setpoints:',arg);
   
    var tmp = collectSetpoints();
    var uniqueModules = tmp[0];
    var setpoints = tmp[1];

    var fn = path.join(arg[1],arg[0]);
    fs.writeFile(fn, JSON.stringify(setpoints), 'utf8', function (err) {
        if (err) {
            console.log(err); addLog(err,'Script','Error');
            ipcRenderer.send('setpointsSaved',[false,err.message]);
        } else {
            addLog('saved '+setpoints.length+' setpoints from '+uniqueModules.length+' module(s) ('+uniqueModules.join([separator = ','])+') to '+path.basename(fn),'Script','');
            console.log('saved',fn)
            Settings.set('setpointFolder',path.dirname(fn));
            ipcRenderer.send('setpointsSaved',[true,null]);
        }
    });
});


function parseAndSetSetpoints(data,origin){

    var txt = data.toString();
    var setpoints = JSON.parse(txt);
    var counter=0;
    var modules = [];
    for (var i=0;i<setpoints.length;i++) {
        if (document.getElementById(setpoints[i][0]+'-setValue')){
            document.getElementById(setpoints[i][0]+'-setValue').value = setpoints[i][1];
            changedSetValue(document.getElementById(setpoints[i][0]+'-setValue'));
            counter++;
            var tmp = setpoints[i][0].split('-');
            modules.push(dataManager.getModuleName(tmp[0]));
        }       
    }
    uniqueModules = modules.filter(function(elem, pos) {
        return modules.indexOf(elem) == pos;
    });
    addLog('loaded '+counter+' setpoints for '+uniqueModules.length+' module(s) ('+uniqueModules.join([separator = ','])+').',origin,'');
    return true;
}


function collectSetpoints(){
    var items = dataManager.getDataItems();
    var setpoints = [];
    var counter=0;
    var modules = [];
    for (var i=0;i<items.length;i++){
        if (items[i].setValue != undefined) {
            counter++;
            modules.push(items[i].moduleName);
            setpoints.push([items[i].fullId, items[i].setValue]);
        }
    }
    var uniqueModules = modules.filter(function(elem, pos) {
        return modules.indexOf(elem) == pos;
    })
    console.log(setpoints);
    return [uniqueModules,setpoints];
}

function saveSetpoints(){
    console.log('save setpoints')
    var tmp = collectSetpoints();
    var uniqueModules = tmp[0];
    var setpoints = tmp[1];
    var p = path.join(Settings.get('setpointFolder'),'setpoints.set');

    dialog.showSaveDialog({defaultPath: p, title:'Save setpoints'}, function(filename){
        if (filename === undefined) return;
        fs.writeFile(filename, JSON.stringify(setpoints), 'utf8', function (err) {
            if (err) {
                return console.log(err);
            }
            addLog('saved '+setpoints.length+' setpoints from '+uniqueModules.length+' module(s) ('+uniqueModules.join([separator = ','])+') to '+path.basename(filename),'User','');
            console.log('saved',filename)
            Settings.set('setpointFolder',path.dirname(filename));
        });
    })
}



function displayUpdate(){

    var moduleIds = dataManager.getModuleUIDs();
    for (var i=0;i<Modules.length;i++){
        document.getElementById('moduleNameLabel-'+Modules[i].uid).innerHTML = Modules[i].name;
        if (Modules[i].extVoltage>4) {
            document.getElementById('ext-power-label-'+Modules[i].uid).innerHTML = Modules[i].extVoltage.toFixed(2)+' V @ '+Modules[i].extCurrent.toFixed(2)+' A';
            document.getElementById('ext-power-'+Modules[i].uid).style.visibility = 'visible';
        }
    }

    var item;
    var moduleDiv;
    var fullId;
    var dataContainerDiv;
    var obj;

    //console.log('length = ',dataManager.dataItems.length);

    for (var i=0;i<dataManager.dataItems.length;i++){

        item = dataManager.dataItems[i];
        var moduleDiv = document.getElementById(item.moduleUID);
        fullId = item.moduleUID+'-'+item.itemID;
        dataContainerDiv = document.getElementById(fullId);
        if (!dataContainerDiv) createDataItem(item);

        switch(item.type){
            case 'AIO':
                //obj = document.getElementById(fullId+'-setValue');
                //obj.value = eval('item.setValue'+item.setFormat);
                obj = document.getElementById(fullId+'-actValue');
                if (item.actValue=="NaN")
                    obj.innerHTML = 'NaN '+item.unit;
                else {
                    obj.innerHTML = eval('item.actValue'+item.actFormat) +' '+item.unit;
                    //obj.setAttribute('title','update rate: '+parseInt(item.updateRate)+' Hz');
                }
                var d = (item.setMax-item.setMin)*0.05; // todo: solve for different ranges and test for min!=0
                //if (parseInt(item.moduleUID)===3130912261 && item.itemName==="Voltage3")
                //    console.log(item)
                if (item.actValue<(item.setValue-d) || item.actValue>(item.setValue+d)) 
                    obj.className='valuesDisagree';
                else
                    obj.className='';
                break;
            case 'AI':
                obj = document.getElementById(fullId+'-actValue');
                if (item.actValue=="NaN")
                    obj.innerHTML = 'NaN '+item.unit;
                else
                    obj.innerHTML = eval('item.actValue'+item.actFormat) +' '+item.unit;
                if (item.actValue<item.actMin || item.actValue>item.actMax) 
                    obj.className='valueOutOfRange';
                else
                    obj.className='';
                break;
        }
    }
}


ipcRenderer.on('scriptDockScript', (event, args) => { // from main, which redirected it from an editor
    // args = [scriptId, scriptCode, scriptName]
    event.returnValue = 'ok';
    dockAScript(args)
});


ipcRenderer.on('updateDockedScript', (event, args) => { // from main, which redirected it from an editor window
    // args = [scriptId, scriptName]
    event.returnValue = 'ok';
    document.getElementById('label-script-name-'+args[0]).innerHTML=args[1];
    
    console.log('updated script',args[0]);
});

function dockAScript(args){
    // args = [scriptId, scriptCode, scriptName]

    console.log('dockScript',args);
    scriptIds.push(parseInt(args[0]));
    ipcRenderer.send('rendererDockedAScript',args)
    
    if (scriptIds.length===1) { // create Script Main Container
        var obj = document.getElementById('MainContainer');
        var html = document.getElementById('scriptPrototype').innerHTML;
        html = html.replace(/{PANEL}/g,'panel-scripts');
        var el = document.createElement('div');
        el.setAttribute('id','scriptModule');
        el.setAttribute('style','width: 300px; margin-left:20px; margin-top: 0px; margin-bottom:0px;');
        el.className = 'moduleDiv';
        el.setAttribute('ondragstart','dragStart(event,this)');
        el.setAttribute('ondrag','dragging(event,this)');
        el.setAttribute('draggable','true');
        el.innerHTML = html;
        if (Settings.get('scriptModule.display')===0) 
            el.firstChild.removeAttribute('expanded');
        
        var mids = Settings.get('moduleIds');
        if (mids.indexOf('scriptModule')===-1){
            Settings.set('scriptModule.position',mids.length);
            Settings.set('scriptModule.display',1);
            mids.push('scriptModule');
            Settings.set('moduleIds',mids);
        }
            
        el.style.order=Settings.get('scriptModule.position');;

        obj.appendChild(el);
    }
    
    // add script:
    var html = document.getElementById('{SCRIPTID}').innerHTML;
    html = html.replace(/{SCRIPTNAME}/g,args[2]);
    html = html.replace(/{SCRIPTID}/g,args[0]);
    var el = document.createElement('div');
    el.innerHTML = html;
    el.setAttribute('id','script-'+args[0]);
    document.getElementById('panel-scripts').appendChild(el);
}

function removeScript(scriptId){
    scriptIds.splice(scriptId,1);

    


    // update scriptObj in main:
    ipcRenderer.send('removedDockedScript',scriptId);

    document.getElementById('panel-scripts').removeChild(document.getElementById('script-'+scriptId))

    if (scriptId.length===0) {
        var obj = document.getElementById('scriptModule');
        obj.parentElement.removeChild(obj);
    }
}

ipcRenderer.on('changedScriptRunningStatus', (event, arg) => {
    // arg = [scriptId, bool isRunning]
    if (!document.getElementById('btn-run-script-'+arg[0])) return;
    if (arg[1]===true){
        document.getElementById('btn-run-script-'+arg[0]).setAttribute('toggled','toggled');
        document.getElementById('btn-stop-script-'+arg[0]).removeAttribute('disabled');      
        document.getElementById('btn-remove-script-'+arg[0]).setAttribute('disabled','disabled');      
    } else {
        document.getElementById('btn-remove-script-'+arg[0]).removeAttribute('disabled');              
        document.getElementById('btn-run-script-'+arg[0]).removeAttribute('toggled');
        document.getElementById('btn-stop-script-'+arg[0]).setAttribute('disabled','disabled');
    }
});

function runScript(scriptId){
    document.getElementById('btn-run-script-'+scriptId).setAttribute('toggled','toggled');
    document.getElementById('btn-stop-script-'+scriptId).removeAttribute('disabled');
    document.getElementById('btn-remove-script-'+scriptId).setAttribute('disabled','disabled');

    var dataitems = dataManager.getAllDataItems();
    console.log(scriptId,dataitems);
    ipcRenderer.send('runScript',[scriptId,null,null,dataitems]);
}


ipcRenderer.on('scriptFinished', (event, arg) => {
    // arg = [scriptId, scriptName]
    addLog('script '+ arg[1]+' finished','Script','');
    if (!document.getElementById('btn-run-script-'+arg)) return;
    document.getElementById('btn-run-script-'+arg).removeAttribute('toggled');
    document.getElementById('btn-stop-script-'+arg).setAttribute('disabled','disabled');
    document.getElementById('btn-remove-script-'+arg).removeAttribute('disabled');
});

ipcRenderer.on('scriptFailed', (event, arg) => {
    // arg = [scriptId, scriptName]
    addLog('<span style="color:red;">script '+arg[1]+' failed</span>','Script','Error');
    if (!document.getElementById('btn-run-script-'+arg[0])) return;    
    document.getElementById('btn-run-script-'+arg[0]).removeAttribute('toggled');
    document.getElementById('btn-stop-script-'+arg[0]).setAttribute('disabled','disabled');
    document.getElementById('btn-remove-script-'+arg[0]).removeAttribute('disabled');
});

ipcRenderer.on('scriptException', (event, arg) => {
    // arg = [scriptId, name, errMsg]
    addLog(arg[1]+':<span style="color:red;">'+arg[2]+'</span>','Script','Error');
    if (!document.getElementById('btn-run-script-'+arg[0])) return;    
    document.getElementById('btn-run-script-'+arg[0]).removeAttribute('toggled');
    document.getElementById('btn-stop-script-'+arg[0]).setAttribute('disabled','disabled');
    document.getElementById('btn-remove-script-'+arg[0]).removeAttribute('disabled');
});

function stopScript(scriptId){
    if (!document.getElementById('btn-run-script-'+scriptId)) return;
    
    document.getElementById('btn-run-script-'+scriptId).removeAttribute('toggled');
    document.getElementById('btn-stop-script-'+scriptId).setAttribute('disabled','disabled');
    document.getElementById('btn-remove-script-'+scriptId).removeAttribute('disabled');
    console.log('stop script',scriptId)
    ipcRenderer.send('abortScript',scriptId)
}

function editScript(scriptId){
    console.log('editScript',scriptId)
    ipcRenderer.send('editScript',scriptId);
}

ipcRenderer.on('requestScriptFunctions', (event, arg) => { // from main, which redirected it from script editor after opening
    // arg = scriptId
    console.log('requestScriptFunctions',arg)
    event.returnValue = 'ok';
    ipcRenderer.send('transmitScriptFunctions',[arg,dataManager.getAllDataItems()]);
});


ipcRenderer.on('scriptRecording', (event, arg) => { // from main, which redirected it from a scriptRunner; recorder stuff
    // arg = 'start' or 'stop'
    document.getElementById('btn-start-recording').click();
});


ipcRenderer.on('requestLastUpdate', (event, arg) => {
    // arg = [scriptId, moduleName]

    var lastUpdates = []
    for (var i=0;i<dataManager.dataItems.length;i++){
        var item = dataManager.dataItems[i];
        if (item.moduleName===arg[1]) {
            lastUpdates.push(item.lastUpdate);
        }
    }

    ipcRenderer.send('gotLastUpdate',(Date.now()-Math.max(...lastUpdates)));
});

ipcRenderer.on('requestValue', (event, arg) => {
    // arg = [scriptId, moduleName.itemName]
    console.log('Requested Value:', arg)
    var tmp = arg[1].split('.');
    if (tmp.length!==2) {
        ipcRenderer.send('gotValue',null)
    }
    var fullId='';
    for (var i=0;i<dataManager.dataItems.length;i++){
        var item = dataManager.dataItems[i];
        if (item.moduleName===tmp[0] && item.itemName===tmp[1]) {
            fullId = item.moduleUID+'-'+item.itemID;
            break;
        }
    }
    var tmp = fullId.split('-');
    ipcRenderer.send('gotValue',dataManager.getValue(tmp[0],tmp[1],'actValue'));
    
});


ipcRenderer.on('scriptChangedSetValue', (event, arg) => { // from main, which redirected it from a scriptRunner
    // arg = [scriptId, moduleName.itemName, value]
    console.log('changeSetValue:',arg)
    var tmp = arg[1].split('.');
    if (tmp.length!==2) {
        addLog('script faild to set '+arg[1],'Script','Warning'); return;
    }

    var format = '.toString()'
    try {
        eval('arg[2]'+format)
    } catch (err) {
        addLog('script faild to set '+arg[1],'Script','Warning'); return;
    }
    var fullId='';

    for (var i=0;i<dataManager.dataItems.length;i++){
        var item = dataManager.dataItems[i];
        if (item.moduleName===tmp[0] && item.itemName===tmp[1]) {
            fullId = item.moduleUID+'-'+item.itemID;
            var unit = item.unit;
            var format = item.setFormat; 
            break;
        }
    }
    
    if (document.getElementById(fullId+'-setValue')){
        document.getElementById(fullId+'-setValue').value = eval('arg[2]'+format);
        changedSetValue(document.getElementById(fullId+'-setValue'));
    } else {
        addLog('script faild to set '+arg[1],'Script','Warning');
    }
    event.returnValue = 'ok';
});


ipcRenderer.on('dataTimeout', (event, arg) => { // from main, which redirected it from a serialManager
    // arg = [moduleUid, comPort, name]
    console.log('dataTimeout',arg[0]);
    addLog('Warning: '+arg[2]+' timed out ('+arg[1]+')','System','Warning');
    dataManager.onTimeout(arg[0]);
    event.returnValue = 'ok';
});

ipcRenderer.on('updateData', (event, arg) => { // from main, which redirected it from a serialManager
    // arg = [uid, itemid, varname, value]
    //console.log(arg);
    for (var i=0;i<arg.length;i++){
        if (arg[i][2]!=='extVoltage' && arg[i][2]!=='extCurrent')
            dataManager.setValue(arg[i][0],arg[i][1],arg[i][2],arg[i][3]);
        else {
            var index = -1;
            for (var j=0;j<Modules.length;j++)
                if (parseInt(Modules[j].uid)===parseInt(arg[i][0])) { index=j; }
            if (index===-1) continue;
            Modules[index][arg[i][2]] = arg[i][3];
        }
    }
    event.returnValue = 'ok';
});



ipcRenderer.on('registerDataItems', (event, arg) => { // from main, which redirected it from a serialManager
    //arg = [type,uid,name,id,actValue,setValue,setMin,setMax,actMin,actMax,itemname,unit,true])
    //console.log('init:',arg)
    var fullId = arg[1]+'-'+arg[3];
    if (document.getElementById(fullId+'-setValue')){
        var obj = document.getElementById(fullId+'-setValue');
        obj.setAttribute('min',arg[6]);
        obj.setAttribute('max',arg[7]);
        var d = (arg[7]-arg[6])/100; obj.setAttribute('step',d);
        obj.setAttribute('suffix',' '+arg[11]);
        document.getElementById(fullId+'-itemLabel').innerHTML = arg[10];
    }
    if (document.getElementById(fullId+'-actValue')){
        var name = '';
        if (arg[0]==='AIO') name = arg[10];
        if (arg[0]==='AI') name = arg[7];
        document.getElementById(fullId+'-itemLabel').innerHTML = name;
    }
    

    if (arg[0]==='AIO') dataManager.registerAIO(arg[0],arg[1],arg[2],arg[3],arg[4],arg[5],arg[6],arg[7],arg[8],arg[9],arg[10],arg[11],arg[12],arg[13]);
    if (arg[0]==='AI') dataManager.registerAI(arg[0],arg[1],arg[2],arg[3],arg[4],arg[5],arg[6],arg[7],arg[8],arg[9],arg[10]);
    event.returnValue = 'ok';
});

ipcRenderer.on('getModules', (event, arg) => {
    event.returnValue = 'ok';
    checkSerialPorts(arg);
});


ipcRenderer.on('test', (event, arg) => {
    event.returnValue = 'ok';
    console.log('test',arg);
});

ipcRenderer.on('newModuleName', (event, arg) => {
    // arg: [moduleId, name]
    event.returnValue = 'ok';
    console.log('newModuleName:',arg);
});



function startCheckingForSerialports(){
    //console.log('checking for serial ports');
    ipcRenderer.send('getModules','');
}


function identifiedVirtualModule(args){

    //avoid non-unique ModuleNames (problems with recording and scripting...)
    var name=args[2].replace(/([^_a-z0-9]+)/gi, '_');
    var moduleNames=[];
    for (var i=0;i<Modules.length;i++) moduleNames.push(Modules[i].name);

    var newName = name; var counter=1;
    while(moduleNames.indexOf(newName)>=0) {
        newName=name+'-'+counter.toString();
        counter=counter+1;
    }
    args[2]=newName;

    ipcRenderer.send('identifiedSerialModule',args)
    
    var index=-1;
    for (var i=0;i<Modules.length;i++){
        if(args[1]===Modules[i].uid) index=i;
    }
    if (index===-1){
        createModule(args[1],args[2]);
        index = Modules.length;
        Modules.push([]);
        Modules[index].uid = args[1];
        Modules[index].name = args[2];
        Modules[index].extVoltage = 0;
        Modules[index].extCurrent = 0;
        Modules[index].firmwareVersion = args[4]
        Modules[index].protocolVersion = args[5]
    }
}


function checkSerialPorts(portsWorkedOn){

    if (virtuals===true){
        var ports = ['vCOM13','vCOM14']
        var names = ['AIO8','TC3']
        var types = ['AIO8','TC3']
        var uids = [133535,147322]
        for (var v=0;v<2;v++){
            var index = -1;
            for (var i=0;i<portsWorkedOn.length;i++) { if (ports[v]===portsWorkedOn[i]) { index=i; break; } }
            if (index!==-1) continue;
    
            ipcRenderer.send('foundUnworkedSerialport',ports[v]);
            var tmp = setTimeout(identifiedVirtualModule,100,[ports[v],uids[v],names[v],types[v],'0.1.0','0.0.1']);
        }
    }

    SerialPort.list(function (err, ports) {
        ports.forEach(function(port) {
            // check if already there and connected
            var index = -1;
            for (var i=0;i<portsWorkedOn.length;i++) { if (port.comName===portsWorkedOn[i]) { index=i; break; } }
            if (index===-1 && (port.manufacturer.toString().startsWith('Arduino') || port.manufacturer.toString().startsWith('FTDI'))) {
                ipcRenderer.send('foundUnworkedSerialport',port.comName)
                console.log('found unworked serialport:', port.comName);
                var sp = new SerialPort(port.comName,{baudRate:115200, parser: SerialPort.parsers.readline('\n')},function(err){
                    if (err) {
                        ipcRenderer.send('addLog',['(670) Error creating port '+port.comName,'System','Error']);
                        ipcRenderer.send('errorWithPort',port.comName);
                        return console.log('error opening the port....',err.message);
                        sp.close( function(err){
                            if (err) ipcRenderer.send('addLog',['(674) Error closing port '+port.comName+': '+err.message,'System','Error']);
                            if (err) return console.log('error in closing after init:',err.message);
                        });
                    }
                });
                sp.on('open', function(err){
                    if (err) {
                        ipcRenderer.send('addLog',['(681) Error opening port '+port.comName+': '+err.message,'System','Error']);
                        ipcRenderer.send('errorWithPort',port.comName);
                        return console.log('error after opening:',err.message); 
                    }
                    sp.write('identify|'+Math.floor(Math.random()*65536*65536)+'\n', function(err) {
                        console.log('sending identify...');
                        if (err) { 
                            ipcRenderer.send('addLog',['(688) Error writing identify to port '+port.comName+': '+err.message,'System','Error']);
                            ipcRenderer.send('errorWithPort',port.comName);
                            return console.log('error writing identify:',err.message);
                        }                            
                        sp.on('data', function(data){
                            // send to identifyParser when the module answers
                            data=port.comName+'|'+data;
                            sp.close( function(err){
                                if (err) {
                                    ipcRenderer.send('addLog',['(697) Error closing port '+port.comName+': '+err.message,'System','Error']);
                                    ipcRenderer.send('errorWithPort',port.comName);
                                    return console.log('error in closing after init:',err.message);
                                }
                                identifyParser(data);
                                sp = null;
                            });
                        });
                    });
                });
            }
        });
    });
    serialCheckTimeout = myTimeouts(startCheckingForSerialports,500);
}

function identifyParser(data){
    console.log('IdentifyParser:',data);
    data = data.trim();
    var parts = data.split('|');
    if (parts.length!=6) return; // comPort|uid|name|type|protocolVersion|firmwareVersion
    
    var comPort = parts[0];
    var uid = parseInt(parts[1]);
    var name = parts[2];
    var type = parts[3];
    var protocolVersion = parts[4];
    var firmwareVersion = parts[5];
    
    //avoid non-unique ModuleNames (problems with recording and scripting...)
    /*
    var name=name.replace(/([^_a-z0-9]+)/gi, '_');
    var newName = name; var counter=1;

    var namesPresent = [];
    for (var i=0;i<Modules.length;i++){
        if (Modules[i].uid!==uid) namesPresent.push(Modules[i].name);
    }
    if (namesPresent.length>0) {
        while(namesPresent.indexOf(newName)>=0) {
            newName=name+'-'+counter.toString();
            counter=counter+1;
        }
        name=newName;
    }
*/

    ipcRenderer.send('identifiedSerialModule',[comPort,uid,name,type,protocolVersion,firmwareVersion])

    // create HTML container for newly discovered module if it wasn't created yet:
    var index=-1;
    for (var i=0;i<Modules.length;i++){
        if(uid===Modules[i].uid) index=i;
    }
    if (index===-1){
        createModule(uid,name);
        var index = Modules.length;
        Modules.push([]);
        Modules[index].uid = uid;
        Modules[index].name = name;
        Modules[index].extVoltage = 0;
        Modules[index].extCurrent = 0;
        Modules[index].firmwareVersion = firmwareVersion;
        Modules[index].protocolVersion = protocolVersion;
        
    } else addLog(name + ' reconnected','System','');

    console.log(Modules);
}




document.onreadystatechange = function () {
    if (document.readyState == "complete") {
        init(); 
    }
}

function changedSetValue(obj){
    var p = obj.id.split('-');
    dataManager.setValue(p[0],p[1],'setValue',obj.value);
    ipcRenderer.send('changedSetValueByUser',[p[0],p[1],obj.value]);
}


ipcRenderer.on('recorderRequestsData', (event, arg) => {
    // arg = moduleId
    event.returnValue = 'ok';
    ipcRenderer.send('recorderSendData', dataManager.getRecorderData(parseInt(arg)));
});




function showModuleSettings(moduleId){
    moduleId = moduleId.toString();
    console.log(moduleId)
    if (document.getElementById('moduleSettings-'+moduleId)){
        document.body.removeChild(document.getElementById('moduleSettings-'+moduleId));    
        //document.getElementById('moduleSettings-'+moduleId).opened = false;
        return
    }
    
    var modules = dataManager.getModuleUIDs();
    var index = modules.indexOf(moduleId);
    if (index<0) return;
    
    var obj = document.getElementById('moduleSettings').cloneNode(true);
    obj.setAttribute('id','moduleSettings-'+moduleId)
    var html = obj.innerHTML;

    html = html.replace(/{MODULENAME}/g,dataManager.getModuleName(modules[index]));
    html = html.replace(/{MODULEID}/g,modules[index]);
    html = html.replace(/{POLLINTERVAL}/g,Settings.get(modules[index]+'.pollInterval'));
    obj.innerHTML = html;
    document.body.appendChild(obj);
    document.getElementById('moduleSettings-'+moduleId).opened = true;
    
    if (document.getElementById('settingsItemcontainer-'+moduleId))
        document.getElementById('settingsItemcontainer-'+moduleId).parentElement.removeChild(document.getElementById('settingsItemcontainer-'+moduleId))

    obj = document.createElement('div');
    obj.setAttribute('id','settingsItemcontainer-'+moduleId);
    for(var i=0;i<dataManager.dataItems.length;i++){
        if(parseInt(dataManager.dataItems[i].moduleUID)!==parseInt(moduleId)) continue;
        var fullId = dataManager.dataItems[i].moduleUID+'-'+dataManager.dataItems[i].itemID;
        var itemObj = document.getElementById('enabledPrototype-'+moduleId).cloneNode(true);
        itemObj.removeAttribute('class');
        var html = itemObj.innerHTML;
        html = html.replace(/{NAME}/g,dataManager.dataItems[i].itemName);
        html = html.replace(/{FULLID}/g,fullId);
        var toggled=''; if (dataManager.dataItems[i].enabled===true) toggled='toggled';
        html =  html.replace(/enabletoggle/g,toggled);
        toggled=''; if (dataManager.dataItems[i].recordValue===true) toggled='toggled';
        html =  html.replace(/recordtoggle/g,toggled);
        itemObj.innerHTML = html;

        obj.appendChild(itemObj);
    }
    document.getElementById('enabledPrototype-'+moduleId).parentElement.insertBefore(obj,document.getElementById('enabledPrototype-'+moduleId));
}

function disconnectModule(moduleId){
    ipcRenderer.send('disconnectModule',moduleId);
}

function reconnectModule(moduleId){
    ipcRenderer.send('reconnectModule',moduleId);
}

function changeModuleName(moduleId){
    var moduleName = document.getElementById('modulename-'+moduleId).value;

    //avoid non-unique ModuleNames (problems with recording and scripting...)
    var name=moduleName.replace(/([^_a-z0-9]+)/gi, '_');
    var newName = name; var counter=1;
    var namesPresent = [];
    for (var i=0;i<Modules.length;i++){
        if (parseInt(Modules[i].uid)!==parseInt(moduleId)) namesPresent.push(Modules[i].name)
    }
    while(namesPresent.indexOf(newName)>=0) {
        newName=name+'-'+counter.toString();
        counter=counter+1;
    }
    moduleName=newName;

    ipcRenderer.send('changeModuleName',[moduleId, moduleName]);
    
    document.body.removeChild(document.getElementById('moduleSettings-'+moduleId));    
    //document.getElementById('moduleSettings-'+moduleId).opened = false;
}

ipcRenderer.on('changedModuleName', (event, arg) => { // from a serialManager via main - successfully changed name
    // arg = [moduleId, newName]
    event.returnValue = 'ok';
    document.getElementById('moduleNameLabel-'+arg[0]).innerHTML = arg[1];
    dataManager.updateModuleNames(arg[0],arg[1]);
    for (var i=0;i<Modules.length;i++){
        if (parseInt(Modules[i].uid)===parseInt(arg[0])) Modules[i].name=arg[1];
    }
    console.log(dataManager.dataItems);
});


function updateModuleSettings(moduleId){
    var value = document.getElementById('moduleOptionsPollInterval-'+moduleId).value;
    if (value<1) value=1;
    Settings.set(moduleId+'.pollInterval',value);
    ipcRenderer.send('changedModuleSettings',[moduleId, value]);

    for(var i=0;i<dataManager.dataItems.length;i++){
        if(parseInt(dataManager.dataItems[i].moduleUID)!==parseInt(moduleId)) continue;
        var itemid = dataManager.dataItems[i].itemID;
        var fullId = moduleId+'-'+itemid
        var enabled = false; if (document.getElementById('enableSwitch-'+fullId).hasAttribute('toggled')) enabled=true;
        if (enabled!==dataManager.dataItems[i].enabled){
            dataManager.setValue(moduleId,itemid,'enabled',enabled);
            ipcRenderer.send('enableChanged',[moduleId,itemid,enabled]);
            if (enabled===false){
                dataManager.setValue(moduleId,itemid,'actValue','NaN');
                document.getElementById(moduleId+'-'+itemid).style.display='none';
            } else {
                document.getElementById(moduleId+'-'+itemid).removeAttribute('style');
            }   
        }
        var record = false; if (document.getElementById('recordSwitch-'+fullId).hasAttribute('toggled')) record=true;
        dataManager.setValue(moduleId,itemid,'recordValue',record);
        Settings.set('recordValue.'+moduleId+'.'+itemid,record);
    }

    document.body.removeChild(document.getElementById('moduleSettings-'+moduleId));
    //document.getElementById('moduleSettings-'+moduleId).opened = false;
}

function closeModuleSettings(moduleId){
    document.body.removeChild(document.getElementById('moduleSettings-'+moduleId));
    //document.getElementById('moduleSettings-'+moduleId).opened = false;
}

function updateRecorderSettings(){
    var folder = document.getElementById('recorderFolder').value;
    if (folder==='') folder = __dirname;
    Settings.set('recorderFolder',folder);

    var filename = document.getElementById('recorderFilename').value;
    filename=filename.replace(/([^_a-z0-9.<>-]+)/gi, '_');
    if (filename==='') filename = "<year>-<month>-<day>-<hour>h<minute>m<second>s.h5";
    Settings.set('recorderFilename',filename);
    

    var obj = document.getElementById('fileWriteInterval');
    if (obj.value<10) obj.value=10;
    Settings.set('recorderFileWriteInterval',(obj.value*1000));
    if (document.getElementById('saveSetpoints').hasAttribute('toggled'))
        Settings.set('recorderSaveSetpoints',1);
    else
        Settings.set('recorderSaveSetpoints',0);

    if (document.getElementById('saveLogEvents').hasAttribute('toggled'))
        Settings.set('recorderSaveLogEvents',1);
    else
        Settings.set('recorderSaveLogEvents',0);

    if (document.getElementById('recorderAutoNewFile').hasAttribute('toggled'))
        Settings.set('recorderAutoNewFile',1);
    else
        Settings.set('recorderAutoNewFile',0);

    var obj = document.getElementById('recorderNewFileInterval'); //this is in minutes
    if (obj.value<1) obj.value=1;
    if (obj.value>1440) obj.value=1440;
    Settings.set('recorderNewFileInterval',obj.value);
    

    var modules = dataManager.getModuleUIDs();
    for (var i=0;i<modules.length;i++){
        if (!document.getElementById(modules[i]+'-updateInterval')) continue;
        var value = document.getElementById(modules[i]+'-updateInterval').value*1000;
        if (value>Settings.get('recorderFileWriteInterval')) value = Settings.get('recorderFileWriteInterval');
        if (value<10) value=10;
        Settings.set(modules[i]+'.saveInterval',value);
        console.log('saveInterval:',value);
        var obj = document.getElementById(modules[i]+'-recorderInterval');
        document.getElementById('recorderSettingsContainer').removeChild(obj);
    }

    document.getElementById('recorder-settings').opened=false;
}

function cancelRecorderSettings(){
    document.getElementById('recorder-settings').opened = false;
    var modules = dataManager.getModuleUIDs();
    for (var i=0;i<modules.length;i++){
        var obj = document.getElementById(modules[i]+'-recorderInterval');
        document.getElementById('recorderSettingsContainer').removeChild(obj);
    }
}


function init() { 
    addLog('Application started','System','');

    // dock scripts found in Settings:
    if (Settings.has('ScriptIds')){
        var x = Settings.get('ScriptIds');
        for (var i=0;i<x.length;i++){
            if (!Settings.get('Scripts.'+x[i]+'.name')) continue
            dockAScript([x[i],Settings.get('Scripts.'+x[i]+'.code'),Settings.get('Scripts.'+x[i]+'.name')])
        }
    }

    document.getElementById('btn-record-settings').addEventListener("click", () => {
        document.getElementById('recorderFolder').value = Settings.get('recorderFolder');
        document.getElementById('recorderFilename').value = Settings.get('recorderFilename');
        
        var obj = document.getElementById('recorder-settings');
        document.getElementById('fileWriteInterval').value = (Settings.get('recorderFileWriteInterval')/1000);
        
        obj = document.getElementById('saveSetpoints');
        if(Settings.get('recorderSaveSetpoints')>0)
            obj.setAttribute('toggled','toggled');
        else {
            obj.removeAttribute('toggled');
        }

        obj = document.getElementById('saveLogEvents');
        if(Settings.get('recorderSaveLogEvents')>0)
            obj.setAttribute('toggled','toggled');
        else {
            obj.removeAttribute('toggled');
        }

        obj = document.getElementById('recorderAutoNewFile');
        if(Settings.get('recorderAutoNewFile')>0)
            obj.setAttribute('toggled','toggled');
        else {
            obj.removeAttribute('toggled');
        }
        document.getElementById('recorderNewFileInterval').value = Settings.get('recorderNewFileInterval');
    

        var modules = dataManager.getModuleUIDs();
        for (var i=0;i<modules.length;i++){
            var obj = document.getElementById('recorderSettingsPrototype');
            var html = obj.innerHTML;
            html = html.replace(/{MODULENAME}/g,dataManager.getModuleName(modules[i]));
            html = html.replace(/{MODULEID}/g,modules[i]);
            html = html.replace(/{VALUE}/g,(Settings.get(modules[i]+'.saveInterval')/1000));
            //html = html.replace(/{MAX}/g,(Settings.get('recorderFileWriteInterval')/1000));
            
            var newEl = document.createElement('x-box');
            newEl.innerHTML = html;
            newEl.setAttribute('id',modules[i]+'-recorderInterval');
            document.getElementById('recorderSettingsContainer').appendChild(newEl);
        }


        document.getElementById('recorder-settings').opened = true;
    });
    
    // browse button in recorder file dialog:
    document.getElementById("btn-recorder-filename-browse").addEventListener("click", function (e) {
        var path = dialog.showOpenDialog({properties: ['openDirectory'],title:'select folder','defaultPath':Settings.get('recorderFolder')});
        document.getElementById('recorderFolder').value = path;        
    });
    // record-button:
    document.getElementById("btn-start-recording").addEventListener("click", function (e) {
        document.getElementById('btn-record-settings').setAttribute('disabled','');
        var obj = document.getElementById("btn-start-recording");
        if (obj.getAttribute('toggled')===null) {
            document.getElementById('btn-record-settings').removeAttribute('disabled');
            document.getElementById('btn-stop-recording').setAttribute('disabled','');
            console.log('stop recording...');
            ipcRenderer.send('stopRecording');
            //console.log();
        }
        else {
            document.getElementById('btn-record-settings').setAttribute('disabled','');
            document.getElementById('btn-stop-recording').removeAttribute('disabled');
            console.log('start recording...');
            ipcRenderer.sendSync('startRecording');
            ipcRenderer.sendSync('recorderDataitems', dataManager.getDataItems());
            ipcRenderer.sendSync('recorderSettings', {
                'interval': Settings.get('recorderFileWriteInterval'),
                'saveSetpoints': Settings.get('recorderSaveSetpoints'), 
                'saveLogEvents': Settings.get('recorderSaveLogEvents'), 
                'autoNewFile': Settings.get('recorderAutoNewFile'),
                'autoNewFileInterval': Settings.get('recorderNewFileInterval'),
                'folder': Settings.get('recorderFolder'),
                'filename': Settings.get('recorderFilename')
            });
        }
    });
    

    // stop-button:
    document.getElementById("btn-stop-recording").addEventListener("click", function (e) {
        document.getElementById('btn-start-recording').click();
    });

    document.getElementById("close-btn").addEventListener("click", function (e) {

        window.close(); 
    });
}; 

ipcRenderer.on('recorderFatalError', (event, arg) => {
    // arg = moduleId
    event.returnValue = 'ok';
    document.getElementById('btn-record-settings').removeAttribute('disabled');
    document.getElementById('btn-stop-recording').setAttribute('disabled','');
    document.getElementById('btn-start-recording').removeAttribute('toggled');
});


function createDataItem(dataItem){
    var obj = document.getElementById('panel-'+dataItem.moduleUID);
    var ID = dataItem.moduleUID+'-'+dataItem.itemID;
    switch(dataItem.type){
        case 'AIO':
            var html = document.getElementById('{AIOID}').innerHTML;
            html = html.replace(/{NAME}/g,dataItem.itemName);
            html = html.replace(/{STEP}/g,(dataItem.setMax-dataItem.setMin)/100);
            html = html.replace(/{UNIT}/g,dataItem.unit);
            html = html.replace(/{SET}/g,dataItem.setValue);
            html = html.replace(/{FORMAT}/g,dataItem.setFormat);
            html = html.replace(/{ACT}/g,dataItem.actValue);
            html = html.replace(/{MIN}/g,dataItem.setMin);
            html = html.replace(/{MAX}/g,dataItem.setMax);
            html = html.replace(/{ID}/g,ID);
            break;
        case 'AI':
            var html = document.getElementById('{AIID}').innerHTML;
            html = html.replace(/{NAME}/g,dataItem.itemName);
            html = html.replace(/{UNIT}/g,dataItem.unit);
            html = html.replace(/{ACT}/g,dataItem.actValue);
            html = html.replace(/{ID}/g,ID);
            break;
    }
    var newDiv = document.createElement('div');
    newDiv.setAttribute('id',ID);
    if (dataItem.enabled===false) newDiv.style.display='none';
    newDiv.setAttribute('class',dataItem.type);
    newDiv.innerHTML = html;
    obj.appendChild(newDiv);



    var objCreated = document.getElementById(ID);
    objCreated.addEventListener("mousewheel", function (e) {
        //console.log(e.srcElement.id,e.deltaY); 
    });

    
}

function createModule(uid,name){
    var obj = document.getElementById('MainContainer');
    var html = document.getElementById('{MODULEID}').innerHTML;
    html = html.replace(/{MODULEID}/g,uid);
    html = html.replace(/{NAME}/g,name);
    var newDiv = document.createElement('div');
    newDiv.setAttribute('id',uid);
    newDiv.setAttribute('style','width: 300px; margin-left:20px; margin-top: 0px; margin-bottom:0px;');
    newDiv.className = 'moduleDiv';
    newDiv.setAttribute('ondragstart','dragStart(event,this)');
    newDiv.setAttribute('ondrag','dragging(event,this)');
    newDiv.setAttribute('draggable','true');
    newDiv.innerHTML = html;
    if (Settings.get(uid+'.display')===0) 
        newDiv.firstChild.removeAttribute('expanded');


    newDiv.style.order=Settings.get(uid+'.position');;

    obj.appendChild(newDiv);
    
    addLog('added Module: '+name,'System','');
}


function showAIOSettings(fullId){
    console.log(fullId)
    var tmp = fullId.split('-')
    var obj = document.getElementById('AIOSettings').cloneNode(true);
    obj.setAttribute('id','AIOsettings-'+fullId)
    var html = obj.innerHTML;
    html = html.replace(/{FULLID}/g,fullId);
    html = html.replace(/{ITEMNAME}/g,dataManager.getValue(tmp[0],tmp[1],'itemName'));
    html = html.replace(/{ACTMIN}/g,dataManager.getValue(tmp[0],tmp[1],'actMin'));
    html = html.replace(/{ACTMAX}/g,dataManager.getValue(tmp[0],tmp[1],'actMax'));
    html = html.replace(/{SETMIN}/g,dataManager.getValue(tmp[0],tmp[1],'setMin'));
    html = html.replace(/{SETMAX}/g,dataManager.getValue(tmp[0],tmp[1],'setMax'));
    html = html.replace(/{UNIT}/g,dataManager.getValue(tmp[0],tmp[1],'unit'));
    obj.innerHTML = html;
    document.body.appendChild(obj);
    document.getElementById('AIOsettings-'+fullId).opened = true;
}

function updateAIOItemSettings(fullId){
    console.log('update',fullId)

    var tmp = fullId.split('-')    
    var iname = document.getElementById('AIO-itemname-'+fullId).value;
    var actmin = parseFloat(document.getElementById('AIO-actmin-'+fullId).value);
    var actmax = parseFloat(document.getElementById('AIO-actmax-'+fullId).value);
    var setmin = parseFloat(document.getElementById('AIO-setmin-'+fullId).value);
    var setmax = parseFloat(document.getElementById('AIO-setmax-'+fullId).value);
    var unit = document.getElementById('AIO-itemunit-'+fullId).value;
    
    // checks:
    if (actmin>actmax) {var max = actmax; actmax=actmin; actmin=max}
    if (setmin>setmax) {var max = setmax; setmax=setmin; setmin=max}
    if (actmin===actmax) actmax=actmin+1;
    if (setmin===setmax) setmax=setmin+1;

    //avoid non-unique itemNames within a module (problems with recording and scripting...)
    var name=iname.replace(/([^_a-z0-9]+)/gi, '_');
    var namesPresent = [];
    for (var i=0;i<dataManager.dataItems.length;i++) {
        if (dataManager.dataItems[i].moduleUID!==tmp[0]) continue;
        if (dataManager.dataItems[i].moduleUID+'-'+dataManager.dataItems[i].itemID===fullId) continue
        namesPresent.push(dataManager.dataItems[i].itemName);        
    }
    console.log(namesPresent);
    var newName = name; var counter=1;
    while(namesPresent.indexOf(newName)>=0) {
        newName=name+'-'+counter.toString();
        counter=counter+1;
    }
    name=newName;

    console.log(name,actmin,actmax,setmin,setmax,unit)
    ipcRenderer.send('setupAIOChannel',[tmp[0],tmp[1],name,setmin,setmax,actmin,actmax,unit]);
    document.body.removeChild(document.getElementById('AIOsettings-'+fullId));
}

function closeAIOItemSettings(fullId){
    //console.log('cancel',fullId)
    document.body.removeChild(document.getElementById('AIOsettings-'+fullId));
}



function showAISettings(fullId){
    console.log(fullId)
    var tmp = fullId.split('-')
    var obj = document.getElementById('AISettings').cloneNode(true);
    obj.setAttribute('id','AIsettings-'+fullId)
    var html = obj.innerHTML;
    html = html.replace(/{FULLID}/g,fullId);
    html = html.replace(/{ITEMNAME}/g,dataManager.getValue(tmp[0],tmp[1],'itemName'));
    html = html.replace(/{ACTMIN}/g,dataManager.getValue(tmp[0],tmp[1],'actMin'));
    html = html.replace(/{ACTMAX}/g,dataManager.getValue(tmp[0],tmp[1],'actMax'));
    html = html.replace(/{UNIT}/g,dataManager.getValue(tmp[0],tmp[1],'unit'));
    obj.innerHTML = html;
    document.body.appendChild(obj);
    document.getElementById('AIsettings-'+fullId).opened = true;
}

function updateAIItemSettings(fullId){
    console.log('update',fullId)

    var tmp = fullId.split('-')    
    var iname = document.getElementById('AI-itemname-'+fullId).value;
    var actmin = parseFloat(document.getElementById('AI-actmin-'+fullId).value);
    var actmax = parseFloat(document.getElementById('AI-actmax-'+fullId).value);
    var unit = document.getElementById('AI-itemunit-'+fullId).value;
    
    // checks:
    if (actmin>actmax) {var max = actmax; actmax=actmin; actmin=max}
    if (actmin===actmax) actmax=actmin+1;

    //avoid non-unique itemNames within a module (problems with recording and scripting...)
    var name=iname.replace(/([^_a-z0-9]+)/gi, '_');
    var namesPresent = [];
    for (var i=0;i<dataManager.dataItems.length;i++) {
        if (dataManager.dataItems[i].moduleUID!==tmp[0]) continue;
        if (dataManager.dataItems[i].moduleUID+'-'+dataManager.dataItems[i].itemID===fullId) continue
        namesPresent.push(dataManager.dataItems[i].itemName);        
    }
    console.log(namesPresent);
    var newName = name; var counter=1;
    while(namesPresent.indexOf(newName)>=0) {
        newName=name+'-'+counter.toString();
        counter=counter+1;
    }
    name=newName;

    console.log(name,actmin,actmax,unit)
    ipcRenderer.send('setupAIChannel',[tmp[0],tmp[1],name,actmin,actmax,unit]);
    document.body.removeChild(document.getElementById('AIsettings-'+fullId));
}

function closeAIItemSettings(fullId){
    //console.log('cancel',fullId)
    document.body.removeChild(document.getElementById('AIsettings-'+fullId));
}



function openNewEditor(){
    ipcRenderer.send('createNewEditor',true)
}

//------------------------------------------------------------------------------------

function dragging(ev,obj){
    newCenterX = oldCenterX+(ev.offsetX-dragx0);
    newCenterY = oldCenterY+(ev.offsetY-dragy0);
    //console.log('ewcenters:',newCenterX,newCenterY)
}

function dragEnd(ev,obj) {
    ev.preventDefault();
    
    var mids = getDockedModuleIds();

    // first: get closest in x-direction:
    var deltaX = []; var deltaY = [];
    for (var i=0;i<mids.length;i++){
        var obj = document.getElementById(mids[i]);
        var rect = obj.getBoundingClientRect();
        var centerX = rect.left+obj.offsetWidth/2;
        var centerY = rect.top+obj.offsetHeight/2;
        deltaX.push(newCenterX-centerX);
        deltaY.push(newCenterY-centerY);
    }
    var dx = []; for (i=0; i<deltaX.length;i++) dx.push(Math.abs(deltaX[i]));
    var minimum = Math.min(...dx);
    var moveToEnd=false;
    if (Math.min(...deltaX)>200) moveToEnd=true;;
    var closestIds = [];
    var closestDY = []

    for (var i=0;i<deltaX.length;i++)
        if (dx[i]===minimum) {
            closestIds.push(mids[i]);
            closestDY.push(deltaY[i])
        }
    if (closestIds.length===0) { console.log("Error in dragging"); return; }

    // next: get closest in y-direction:
    var dy = []; for (i=0; i<closestDY.length;i++) dy.push(Math.abs(closestDY[i]));
    var minimum = Math.min(...dy);
    var closestId = '';
    for (var i=0;i<closestDY.length;i++)
        if (dy[i]===minimum) {
            closestId=closestIds[i].toString();
            var finalDeltaY = closestDY[i];
        }
    if (closestId==='') { console.log("Error in dragging 2"); return; }
    if (closestId===draggedId) { console.log('no change'); return }
    
    var newPosition=-1;
    if (finalDeltaY<0) 
        newPosition=Settings.get(closestId+'.position')-0.5; 
    else 
        newPosition = Settings.get(closestId+'.position')+0.5;

    if (moveToEnd===true) newPosition=1e6;
    var oldPosition = Settings.get(draggedId+'.position');
    var newPositions = []; var oldPositions = [];
    for (i=0;i<mids.length;i++){
        oldPositions.push(Settings.get(mids[i]+'.position'))
        newPositions[i]=oldPositions[i];
        if (mids[i]===draggedId) newPositions[i]=newPosition;
    }
    
    var finalPositions = [];
    var newSorted = [...newPositions].sort(function (a, b) { return a-b; });
    for (i=0;i<newSorted.length;i++) {
        var index = newPositions.indexOf(newSorted[i]);
        finalPositions[index]=i;
    }

    console.log('oldPositions',oldPositions);
    console.log('newPositions',finalPositions);

    for (i=0;i<mids.length;i++){
        document.getElementById(mids[i]).style.order=finalPositions[i];
        Settings.set(mids[i]+'.position',finalPositions[i]);
    }        

}

var oldCenterX = 0; var oldCenterY = 0;
var newCenterX = 0; var newCenterY = 0;
var dragx0 = 0; var dragy0 = 0;
var draggedId = ''
function dragStart(ev,obj) {
    var rect = obj.getBoundingClientRect();
    oldCenterX = rect.left+obj.offsetWidth/2; newCenterX = oldCenterX;
    oldCenterY = rect.top; newCenterY = oldCenterY;
    dragx0 = ev.offsetX;
    dragy0 = ev.offsetY;
    draggedId = obj.id;
}

function allowDrop(event) {
    event.preventDefault();
}

function getDockedModuleIds(){
    var obj = document.getElementById('MainContainer')
    var mids = [];
    for (var i=0;i<obj.childNodes.length;i++){
        mids.push(obj.childNodes[i].id)
    }
    return mids
}

function togglePower(obj,moduleId) {
    if (document.getElementById('ext-power-label-'+moduleId).style.visibility==='visible')
        document.getElementById('ext-power-label-'+moduleId).style.visibility = 'hidden';
    else
        document.getElementById('ext-power-label-'+moduleId).style.visibility = 'visible';
}