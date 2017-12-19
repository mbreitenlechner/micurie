"use strict"
const sendmail = require('sendmail')();

const esprima = require('esprima');
const {ipcRenderer, remote} = require('electron');
const path = require('path');
const fs = require('fs');
const Settings = require('electron').remote.require('electron-settings')

var sleep = require('sleep');
var vm = require("vm");
var dataitems;

var scriptId;

var errorDetected=false; // used to prevent double error triggering when we discovered a custom error 

document.onreadystatechange = function () {
    if (document.readyState == "complete") {
        init();
    }
}

function init() {
    var win = remote.getCurrentWindow();
    var args = win.getTitle().split('|');
    console.log(args)
    scriptId = parseInt(args[1]);
    console.log('scriptId:',scriptId);
    
    var obj = document.getElementById('code');
    obj.innerHTML = obj.innerHTML+'<br>init: scriptId = '+scriptId;

    ipcRenderer.send('readyToExecute',scriptId);
    console.log('command sent',scriptId)
}

function closeScriptRunner(){
    window.close();
}

ipcRenderer.on('executeScript', (event, arg) => {
    // arg = [scriptId, code, name, dataitems, isEditor]
    runScript(arg[0],arg[1],arg[2],arg[3],arg[4]);
});

function throwCustomError(scriptId, scriptName, lineNr, msg){
    var finalMsg = msg+' at '+scriptName+' '+lineNr;
    if (lineNr<0) finalMsg = msg + ' at '+scriptName;
    ipcRenderer.send('scriptException',[scriptId, scriptName, finalMsg]);            
    ipcRenderer.send('scriptFailed',[scriptId, scriptName]);
    errorDetected = true;
    return
}

function runScript(scriptId,code,name,dataitems,isEditor){

    // add line numbers in sleep and log statements; thats a bit of a hack but works just fine
    var lines = [];

    try {
        var tokens = esprima.tokenize(code,{loc: true});
    } catch(err) {
        success=false;
        msg = err.message.toString();
        var tmp = msg.substring(msg.indexOf('Line ')+5,msg.indexOf(':'))
        lineNr = parseInt(tmp);
        console.log(tmp,lineNr);
        throwCustomError(scriptId, name, lineNr, 'Syntax Error')
        return
    }
    var functionsToCatch = ['sleepMs','sleep','log'];
    var found=false;
    var line;
    for (var i=0;i<tokens.length;i++){
        line = tokens[i].loc.start.line;
        if(!lines[line]) lines[line]='';
        if (tokens[i].type==='Identifier' && functionsToCatch.indexOf(tokens[i].value)>=0) found=true;
        lines[line] = lines[line]+tokens[i].value;
        if (tokens[i].type==="Keyword") lines[line] = lines[line]+' '; 
        if (found===true && tokens[i].type==="Punctuator" && tokens[i].value==="("){
            found=false;
            lines[line] = lines[line]+line+', ';
        }
    }
    code = lines.join("\n");
    code = code.trim();
    var hcode = code.replace(/</g,"&lt;");
    hcode = hcode.replace(/>/g, "&gt;");
    document.getElementById('code').innerHTML = hcode;
    
    // create context to run the script in:
    var obj = {};
    obj.log = function(lineNr,msg) {
        if (msg===null) msg='null';
        if (msg===undefined) msg='undefined';
        msg = msg.toString();
        msg = msg.replace(/</g,"&lt;");
        msg = msg.replace(/>/g,"&gt;");
        console.log('scriptId:',scriptId);
        ipcRenderer.send('scriptPrintLog',[scriptId, name+' <span style="color:green">('+lineNr+')</span>: <span style="color:blue">'+msg+'</span>'])
    };

    obj.sleepMs = function(lineNr,i) {
        //console.log('lineNr =',lineNr);
        if (!isEditor || i<100) { sleep.msleep(i); return }
        //console.log('i=',i);
        ipcRenderer.send('reportScriptPosition',[scriptId,'sleepMs',i,lineNr,'start'])
        
        var start = process.hrtime();
        var elapsed = 0;
        while (elapsed<i){
            var tmp = process.hrtime(start);
            elapsed = (tmp[0]+tmp[1]/1e9)*1e3; //ms
            if (elapsed>i) break;
            if(ipcRenderer.sendSync('checkForSkipSleep',[scriptId,lineNr])===true) break;
            sleep.msleep(10);
        }
        //console.log('skipTest:',ipcRenderer.sendSync('checkForSkipSleep',[scriptId,editorId,lineNr]))

        ipcRenderer.send('reportScriptPosition',[scriptId,'sleepMs',i,lineNr,'end'])
        return
    }
    


    obj.sleep = function(lineNr,i) {
        // a little fix here: sleep(0.8) runs fine in editor but throws an error if executed in window
        // reason is: sleep does not take decimals, just integers
        if (!Number.isInteger(i) || i<1) {
            throwCustomError(scriptId,name,lineNr,'Error: argument 1 of sleep must be an integer')
            sleep.sleepMs(500); // enough time that main.js can close this window before proceeding in the script
            return
        }
        if (!isEditor || i<0.1) { sleep.sleep(i); return }
        ipcRenderer.send('reportScriptPosition',[scriptId,'sleep',i,lineNr,'start'])
        
        var start = process.hrtime();
        var elapsed = 0;
        while (elapsed<i){
            var tmp = process.hrtime(start);
            elapsed = (tmp[0]+tmp[1]/1e9); //s
            if (elapsed>i) break;
            if(ipcRenderer.sendSync('checkForSkipSleep',[scriptId,lineNr])===true) break;
            sleep.msleep(10);
        }

        ipcRenderer.send('reportScriptPosition',[scriptId,'sleep',i,lineNr,'end'])
    }
    
    obj.sendEmail = function(from,to,subject,html) {
        sendmail({
            from: from,
            to: to,
            subject: subject,
            html: html,
          }, function(err, reply) {
            if (err) {
                console.log(err);
                ipcRenderer.send('addLog',[err.message,'Script','Warning'])                
                return false;
            }
            else return true;
            console.log(err && err.stack);
        });
    }

    // settings:
    obj.settings = {};
    obj.settings.set = function(key,value) { 
        Settings.set(key,value)
        if (Settings.has(key)) return true; else return false
    }
    obj.settings.get = function(key) { 
        if (Settings.has(key)) { return Settings.get(key); return true } else return null
    }
    obj.settings.has = function(key) { return Settings.has(key) }
    obj.settings.deleteKey = function(key) {
        if (Settings.has(key)) { Settings.delete(key); return true } else return false
    }
    
    // recorder stuff:
    obj.recorder = {};
    obj.recorder.start = function(){return ipcRenderer.sendSync('recorderFromScript',['start',true]); }
    obj.recorder.stop = function(){return ipcRenderer.sendSync('recorderFromScript',['stop',true]); }
    obj.recorder.getFilename = function(){return ipcRenderer.sendSync('recorderFromScript',['getFilename',true]); }
    obj.recorder.getPath = function(){ return ipcRenderer.sendSync('recorderFromScript',['getPath',true]); }
    obj.recorder.setFilename = function(p,filename){
        var fullPath = path.join(p,filename);
        console.log('setFilename:',path.basename(fullPath));
        if (!fs.existsSync(p)) {
            throwCustomError(scriptId,name,-1,'Error: could not find path: "'+p+'"');
            sleep.sleepMs(500);
            return false           
        }

        return ipcRenderer.sendSync('recorderFromScript',['setFilename',p,filename]);
    }
    obj.recorder.isRunning = function(){ return ipcRenderer.sendSync('recorderFromScript',['isRunning',true]); }
    
    // save & load setpoints:
    obj.setpoints = {};
    obj.setpoints.saveSetpoints = function(filename,path) {
        if (path===undefined) path = Settings.get('setpointFolder');
        if (!fs.existsSync(path)) {
            throwCustomError(scriptId,name,-1,'Error: could not find path: "'+path+'"');
            sleep.sleepMs(500);
            return false           
        }
        filename = filename.trim();
        if (filename.length<1) {
            throwCustomError(scriptId,name,-1,'Error: invalid filename: "'+filename+'"');
            sleep.sleepMs(500);
            return false           
        }
        return ipcRenderer.sendSync('scriptSavesSetpoints',[scriptId,filename,path])
    }

    obj.setpoints.loadSetpoints = function(filename,path) {
        if (path===undefined) path = Settings.get('setpointFolder');
        if (!fs.existsSync(path)) {
            throwCustomError(scriptId,name,-1,'Error: could not find path: "'+path+'"');
            sleep.sleepMs(500);
            return false           
        }
        filename = filename.trim();
        if (filename.length<1) {
            throwCustomError(scriptId,name,-1,'Error: invalid filename: "'+filename+'"');
            sleep.sleepMs(500);
            return false           
        }
        return ipcRenderer.sendSync('scriptLoadSetpoints',[scriptId,filename,path])
    }
    
    obj.setpoints.getCurrentPath = function() { return Settings.get('setpointFolder'); }
    obj.setpoints.setCurrentPath = function(path) { 
        if (!fs.existsSync(path)) {
            throwCustomError(scriptId,name,-1,'Error: path: "'+path+'" does not exist');
            sleep.sleepMs(500);
            return false           
        }
        Settings.set('setpointFolder',path);
        return true;
    }
    

    // AIO & AI stuff
    var moduleNames = [];
    for (var i=0;i<dataitems.length;i++){
        if (moduleNames.indexOf(dataitems[i].moduleName)===-1) moduleNames.push(dataitems[i].moduleName)
    }    
    for (var i=0;i<moduleNames.length;i++){
        eval('obj.'+moduleNames[i]+' = {};')
        eval('obj.'+moduleNames[i]+'.millisecondsSinceLastUpdate = function(){return ipcRenderer.sendSync("scriptRequestslastUpdate",['+scriptId+',"'+moduleNames[i]+'"]) }');
        
    }
    for (var i=0;i<dataitems.length;i++){
        eval('obj.'+dataitems[i].moduleName+'.'+dataitems[i].itemName+' = {};')
        eval('obj.'+dataitems[i].moduleName+'.'+dataitems[i].itemName+'.getValue = function(){return ipcRenderer.sendSync("scriptRequestsValue",['+scriptId+',"'+dataitems[i].moduleName+'.'+dataitems[i].itemName+'"])}')
        if (dataitems[i].type==="AIO")
        eval('obj.'+dataitems[i].moduleName+'.'+dataitems[i].itemName+'.setValue = function(value){ipcRenderer.send("scriptChangedSetValue",['+scriptId+',"'+dataitems[i].moduleName+'.'+dataitems[i].itemName+'",value])}')
    }

    var ctx = vm.createContext(obj);

    var script = vm.createScript(code,{displayErrors: true});
    var success=true;
    try {
        script.runInNewContext(ctx)
    } catch(err) {
        success=false
        if (errorDetected===true) return;
        var msg = err.stack.toString();
        console.log(msg);
        msg = msg.substring(0,msg.indexOf('at ContextifyScript.Script.runInContext'));
        msg = msg.replace(/evalmachine/g,name);
        ipcRenderer.send('scriptException',[scriptId, name, msg]);
    }

    if (success) 
        ipcRenderer.send('scriptFinished',[scriptId, name]);
    else
        ipcRenderer.send('scriptFailed',[scriptId, name]);
}
