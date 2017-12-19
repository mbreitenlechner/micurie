"use strict"

const loader = require('monaco-loader')
var Settings = require('electron').remote.require('electron-settings')
const fs = require('fs');
const {ipcRenderer, remote} = require('electron');
const path = require('path');
const {dialog} = require('electron').remote;

var currentFileName = path.join(Settings.get('scriptPath'),'untitled.js');
var editor;
var decorationList = [];
var decorations;
var closeWindow = false;
var scriptId;
var dataitems;

var doSkipSleep = -1;

var isRunning=false;
var originalScriptName='';
var dockedScriptNames = [];
var sleep = require('sleep');
var vm = require("vm");

document.onreadystatechange = function () {
    if (document.readyState == "complete") {
        init();
    }
}

function init() {
    window.setInterval(checkIfScriptIsRunning,50);
    var win = remote.getCurrentWindow();
    var args = win.getTitle().split('|');
    console.log(args);
    scriptId=parseInt(args[1]);
    console.log('scriptId:',scriptId);

    document.title = args[0];
    var isNewScript=false; if (args[2]==='true') isNewScript=true; 

    ipcRenderer.send('requestScriptFunctions',scriptId);
}

function checkIfScriptIsRunning(){
    ipcRenderer.send('checkIfScriptIsRunning',scriptId)
}

ipcRenderer.on('isRunning', (event, arg) => {
    event.returnValue = 'ok';
    if (arg===true) {
        document.getElementById('btn-stop-script').removeAttribute('disabled');
        document.getElementById('btn-start-script').setAttribute('toggled','toggled');
    } else {
        document.getElementById('btn-stop-script').setAttribute('disabled','disabled');
        document.getElementById('btn-start-script').removeAttribute('toggled');
    }
});

ipcRenderer.on('checkSkipSleep', (event, arg) => {
    // arg = [scriptId, lineNr]
    if (closeWindow===true) {ipcRenderer.send('returnedSkipSleep',false); window.close()}
    event.returnValue = 'ok';
    if (arg[1]===doSkipSleep) {
        doSkipSleep=-1;
        ipcRenderer.send('returnedSkipSleep', true);
        }
    else
        ipcRenderer.send('returnedSkipSleep', false);
});

ipcRenderer.on('reportScriptPosition', (event, arg) => {
    // arg = [scriptId, function, functionArg, lineNr, 'start'/'end']
    var lineNr = arg[3];
    var fct = arg[1];
    var fctArg = arg[2];
    var action = arg[4];
    if ((fct==='sleep' && fctArg>=0.2) || (fct==='sleepMs' && fctArg>=200)){
        if (action==='start'){
            decorationList.push({
                range: new monaco.Range(lineNr, 1, lineNr, 1), options: {isWholeLine: true, linesDecorationsClassName: 'sleepDecoration'}
            });
            if (decorations) 
                decorations = editor.deltaDecorations(decorations, decorationList);
            else
                decorations = editor.deltaDecorations([], decorationList);
            
            console.log(decorationList);
            document.getElementById('btn-skip-sleep').removeAttribute('disabled');
            document.getElementById('btn-skip-sleep').setAttribute('onClick','skipSleep('+lineNr+')');
        } else {
            for (var i=0;i<decorationList.length;i++){
                console.log('line:',decorationList[i].range.startLineNumber)
                if (decorationList[i].range.startLineNumber === lineNr && decorationList[i].options.linesDecorationsClassName==='sleepDecoration'){
                    decorationList.splice(i,1);
                }
            }
            decorations = editor.deltaDecorations(decorations, decorationList);
            document.getElementById('btn-skip-sleep').setAttribute('disabled','disabled');
        }
    }
    
});

function skipSleep(lineNr){
    doSkipSleep = lineNr;
}



ipcRenderer.on('transmitScriptFunctions', (event, arg) => {
    console.log('ScriptFunctions:',arg)
    dataitems=arg[0];
    dockedScriptNames = arg[1];
    console.log('docked script names:',dockedScriptNames)
    event.returnValue = 'ok';
    console.log('transmitScriptFunctions:',arg);

    var fcts = fs.readFileSync('scriptFunctions.d.ts');
    fcts = fcts.toString();
    fcts = fcts.split('\n');
    var myFunctions = fcts;

    var moduleNames = [];
    for (var i=0;i<dataitems.length;i++){
        if (moduleNames.indexOf(dataitems[i].moduleName)===-1) moduleNames.push(dataitems[i].moduleName)
    }       
    console.log(moduleNames) 
    for (var j=0;j<moduleNames.length;j++){
        var str = 'declare namespace '+moduleNames[j]+'{';
        str = str+'declare function millisecondsSinceLastUpdate(void): number; ';
        var counter=0;
        for (var i=0;i<dataitems.length;i++){
            if (dataitems[i].moduleName!==moduleNames[j]) continue;
            if (dataitems[i].type === 'AIO'){
                str = str+'declare namespace '+dataitems[i].itemName+'{declare function getValue(void): number; declare function setValue(number: value):boolean};';
                counter++
            }
            if (dataitems[i].type === 'AI') {
                str=str+'declare namespace '+dataitems[i].itemName+'{declare function getValue(void): number;}';
                counter++;
            }
        }
        str=str.substr(0,str.length-1)+'}';
        console.log(str);
        if (counter>0) myFunctions.push(str);
    }

    loader().then((monaco) => {
        monaco.languages.typescript.javascriptDefaults.addExtraLib(myFunctions.join('\n'), 'filename/facts.d.ts');

        editor = monaco.editor.create(document.getElementById('container'), {
          language: 'javascript',
          theme: 'vs',
          automaticLayout: true
       });
        ipcRenderer.send('requestScriptArgs',scriptId)
    }) 
});

ipcRenderer.on('scriptFinished', (event, arg) => {
    event.returnValue = 'ok';
    document.getElementById('btn-stop-script').setAttribute('disabled','disabled');
    document.getElementById('btn-start-script').removeAttribute('toggled');
    console.log('stop script...');
    isRunning=false;
    addLog('script finished')
});

ipcRenderer.on('setValueNotFound', (event, arg) => {
    // arg = [scriptId, valueWhichWasntFound]
    event.returnValue = 'ok';
    addLog('<span style="color:orange">value '+arg[1]+' could not be set</span>')
});

ipcRenderer.on('scriptLog', (event, arg) => {
    // arg = [scriptId, msg]
    event.returnValue = 'ok';
    console.log('LOG:',arg);
    addLog(arg[1])
});

ipcRenderer.on('scriptFailed', (event, arg) => {
    event.returnValue = 'ok';
    document.getElementById('btn-stop-script').setAttribute('disabled','disabled');
    document.getElementById('btn-start-script').removeAttribute('toggled');
    console.log('stop script...');
    isRunning=false;
    addLog('<span style="color:red;">script aborted</span>')
});

ipcRenderer.on('scriptException', (event, arg) => {
    event.returnValue = 'ok';
    document.getElementById('btn-stop-script').setAttribute('disabled','disabled');
    document.getElementById('btn-start-script').removeAttribute('toggled');
    addLog(arg[1]);
});

ipcRenderer.on('transmitScriptArgs', (event, args) => { // from renderer via main, after creating this window
    // args = [scriptId, scriptCode, scriptName, bool: isDocked]
    event.returnValue = 'ok';
    if (args[3]===true){
        document.getElementById('icon-dock-script').setAttribute('name','keyboard-backspace');
        document.getElementById('btn-dock-script').setAttribute('onMouseOver','status("update this script in main window")');
        document.getElementById('btn-dock-script').setAttribute('onClick','updateScript('+scriptId+')');
    }
    var scriptName = args[2].toString();
    scriptName.trim();
    if (scriptName.length<1) scriptName = "untitled.js";
    currentFileName =  path.join(Settings.get('scriptPath'),scriptName);
    originalScriptName = scriptName.trim().toLowerCase();
    document.getElementById('script-name').value=scriptName;
    console.log('transmitted:',args);
    editor.setValue(args[1]);
    document.title = args[2]+' - Javascript Editor';
    document.getElementById('tit').innerHTML=args[2]+' - Javascript Editor';

    document.getElementById('container').style.visibility = 'visible';
});

function updateScript(scriptId){
    ipcRenderer.send('updateDockedScript',[scriptId,editor.getValue(),path.basename(currentFileName.toString())]);
    closeEditor();
}

function closeEditor(){
    Settings.set('editorWindow.x',window.screenX);
    Settings.set('editorWindow.y',window.screenY);
    if (ipcRenderer.sendSync('closeEditor', scriptId)===true) closeWindow = true;
    if (isRunning===false) window.close();
}

window.addEventListener("resize", function (e) {
    Settings.set('editorWindow.width',window.outerWidth);
    Settings.set('editorWindow.height',window.outerHeight);
});


function loadScript(){
    console.log('load Script')
    dialog.showOpenDialog({filters: [{extensions: ['set']}], defaultPath: Settings.get('scriptPath'), title:'Load script'}, function(filename){
        if (filename === undefined) return;
        fs.readFile(filename[0], (err, data) => {
            console.log(data.toString());
            editor.setValue(data.toString());
            status('loaded '+ filename +'.');
            currentFileName = filename;
            document.title = path.basename(filename.toString())+ ' - Javascript Editor';
            document.getElementById('tit').innerHTML = path.basename(filename.toString())+ ' - Javascript Editor';
            addLog('loaded script '+path.basename(filename.toString()))
            document.getElementById('script-name').value = path.basename(filename.toString());
            changeName(document.getElementById('script-name'));                     
        });
    });
}

function saveScriptAs(){
    dialog.showSaveDialog({defaultPath: currentFileName, title:'Save script as'}, function(filename){
        fs.writeFile(filename, editor.getValue(), 'utf8', function (err) {
            if (err) {
                return console.log(err);
            }
            status('saved '+filename+').');
            currentFileName = filename.toString();
            console.log('saved',filename)
            Settings.set('scriptPath',path.dirname(filename.toString()));
            console.log(path.basename(filename));
            addLog('script saved as'+path.basename(filename.toString()));
            document.getElementById('script-name').value = path.basename(filename.toString());   
            changeName(document.getElementById('script-name'));         
        });
    })
}

function saveScript(){
    fs.writeFile(currentFileName.toString(), editor.getValue(), 'utf8', function (err) {
        if (err) {
            return console.log(err);
        }
        status('saved '+currentFileName+').');
        console.log('saved',currentFileName)
        addLog(path.basename(currentFileName)+' saved')
    });
}

function dockScript(){
    ipcRenderer.send('scriptDockScript',[scriptId,editor.getValue(),path.basename(currentFileName.toString())]);
    closeEditor();
}

function changeName(obj){
    var txt = obj.value.trim();
    console.log(txt,originalScriptName);
    if (txt===originalScriptName){
        document.getElementById('icon-dock-script').setAttribute('name','keyboard-backspace');
        document.getElementById('btn-dock-script').setAttribute('onMouseOver','status("update this script in main window")');
        document.getElementById('btn-dock-script').setAttribute('onClick','updateScript('+scriptId+')');
    } else {
        document.getElementById('icon-dock-script').setAttribute('name','playlist-add');
        document.getElementById('btn-dock-script').setAttribute('onMouseOver','status("Dock script in main window")');
        document.getElementById('btn-dock-script').setAttribute('onClick','dockScript()');
    }

    // disable update, if proposed name is already present:
    var c=0;
    for (var i=0;i<dockedScriptNames.length;i++){
        if (dockedScriptNames[i]===txt && txt!==originalScriptName) c++;
    }
    if (c>0)
        document.getElementById('icon-dock-script').setAttribute('disabled','disabled');
    else
        document.getElementById('icon-dock-script').removeAttribute('disabled');
    
    currentFileName = path.join(Settings.get('scriptPath'),txt);
    document.title = txt+' - Javascript Editor';
    document.getElementById('tit').innerHTML = txt+' - Javascript Editor';
    console.log(txt);
}

function addLog(msg){
    msg = msg.toString();
    if (msg.indexOf('Error')>=0) msg = '<span style="color: red">'+msg+'</span>';
    var obj = document.getElementById('bottom');
    var html = obj.innerHTML;
    if (html==='script output') html='';
    html = html + "<br>"+msg;
    if (html.startsWith('<br>')) html=html.substring(4);
    obj.innerHTML = html;
    obj.scrollTop = obj.scrollHeight;
}

function runScript(){
    decorationList = [];
    document.getElementById('btn-stop-script').removeAttribute('disabled');
    console.log('start script...!');
    isRunning=true;
    console.log('scriptId:',scriptId);
    
    ipcRenderer.send('runScript',[scriptId,editor.getValue(),path.basename(currentFileName),dataitems]);
    addLog('started script')
}

function stopScript(obj){
    document.getElementById('btn-stop-script').setAttribute('disabled','disabled');
    document.getElementById('btn-start-script').removeAttribute('toggled');
    console.log('stop script...');
    addLog('aborted script');
    ipcRenderer.send('abortScript',scriptId)
    isRunning=false;
}