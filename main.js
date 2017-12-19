"use strict"

const Settings = require('electron-settings');
const defaultSettings = require('./defaultSettings');
const electron = require('electron');
const {app, BrowserWindow, Menu, ipcMain} = electron;
const path = require('path');
const url = require('url');
const {webContents} = require('electron');
const fs = require('fs');

let serialManagers = [];    // these are Windows
var scriptObj = [];

var serialPortsWorkedOn = [];   // these are PORTS which one of the managers works on
var serialModuleIds = [];       // uids of Modules worked on

var production = false;             // hides serialmanager windows and recorder windows, disables devtools everywhere
var keepScriptRunnersAlive = false; // for debugging scriptrunners only (scripts won't stop when aborted if this is true)

var isRecording = false;

let mainWindow;
let appSettingsWindow;
let recorderWindow;

function createWindow(){
    
    defaultSettings.setDefaultSettings();

    // create browser window
    var max=false;
    if (Settings.get('Window.isMaximized')) max=true;
    var showDevTools = true;
    if (production===true) showDevTools = false;
    mainWindow = new BrowserWindow({
        width: Settings.get('Window.width'),
        height: Settings.get('Window.height'),
        x: Settings.get('Window.x'),
        y: Settings.get('Window.y'),
        webPreferences: {'devTools': showDevTools},
        fullscreen: max,
        icon: path.join(__dirname,'assets','icons','png','icon.png'),
        frame: false
    
    });

    // Load index.html:
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname,'index.html'),
        protocol: 'file:',
        slashes: true,
        show: false
    }));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show()
    })

    // create hdf5 recorder process:
    var showDevTools = true;
    if (production===true) showDevTools = false;
    recorderWindow = new BrowserWindow({
        width: 400, 
        height:100, 
        frame:false, 
        webPreferences: {'devTools': showDevTools},
        show:showDevTools})
    recorderWindow.loadURL(url.format({pathname: path.join(__dirname,'recorder.html'), protocol: 'file:', slashes: true, }));

    // quit app when closed:
    mainWindow.on('closed', function(){
        for (var i=0;i<serialManagers.length;i++) { if (serialManagers[i]) serialManagers[i].close();}
        recorderWindow.close();
        app.quit();
    })

    // open devtools:
    mainWindow.webContents.openDevTools();

    mainWindow.on('closed',() => {mainWindow = null})

    // build menu from template:
    const mainMenu = Menu.buildFromTemplate(mainMenuTemplate);
    //insert menu
    Menu.setApplicationMenu(mainMenu);

    // Garbage collection
    recorderWindow.on('close', function(){
        recorderWindow = null;
    })
    //systemInfoWindow.on('close', function(){
    //    systemInfoWindow = null;
    //})

}



app.on('ready',createWindow);

// quit when all windows are closed:
app.on('window-all-closed', () =>{
   
    if(process.platform !== 'darwin'){
        app.quit();
    }
});

function getIndex(uid){
    var index=-1;
    for (var i=0;i<serialModuleIds.length;i++){
        if (parseInt(uid)===parseInt(serialModuleIds[i])) { index=i; break }
    }
    return index;
}

ipcMain.on('addLog', (event,arg) => { // from anywhere
    // arg = [msg, origin, type]
    if (mainWindow) mainWindow.webContents.send('addLog',arg);
});


ipcMain.on('openAppSettings', (event,arg) => { // from renderer (menu)
    // arg = 'info' or 'settings' or 'log'
    var showDevTools = true;
    if (production===true) showDevTools = false;
    appSettingsWindow = new BrowserWindow({
        width: Settings.get('appSettingsWindow.width'),
        height: Settings.get('appSettingsWindow.height'),
        x: Settings.get('appSettingsWindow.x'),
        y: Settings.get('appSettingsWindow.y'),
        webPreferences: {'devTools': showDevTools},
        frame: false,
        show: true,
        icon: path.join(__dirname,'assets','icons','png','icon.png'),
        title: 'Application Settings|'+arg,
        titleBarStyle: 'hidden'
    });

   appSettingsWindow.loadURL(url.format({
        pathname: path.join(__dirname,'./appSettings.html'),
        protocol: 'file:',
        slashes: true
    }));
    appSettingsWindow.on('close', function(){
        appSettingsWindow = null;
    })
})

ipcMain.on('moduleTimedOut', (event,arg) => { // from a serialManager
    // arg = [moduleUid, comPort, moduleName]
    if (mainWindow) mainWindow.webContents.send('dataTimeout',arg);
});

ipcMain.on('errorWithPort', (event,arg) => { // from renderer
    // arg = comportName
    var index = -1
    for (var i=0;i<serialPortsWorkedOn.length;i++) {
        if (arg===serialPortsWorkedOn[i]) index=i;
    }
    if (index>=0) serialPortsWorkedOn[index]=null

    mainWindow.send('test',serialPortsWorkedOn)
})


ipcMain.on('moduleTimedOutFatal', (event,arg) => { // from a serialManager
    // arg = [moduleUid, comPort, name]
    var index = getIndex(arg[0]);
    if (index===-1) return;
    serialModuleIds[index]=null
    serialManagers[index].close();
    serialManagers[index]=null;

    var index = -1
    for (var i=0;i<serialPortsWorkedOn.length;i++) {
        if (arg[1]===serialPortsWorkedOn[i]) index=i;
    }
    if (index>=0) serialPortsWorkedOn[index]=null

    if (mainWindow) { mainWindow.send('addLog',['Error: '+arg[2]+' disconnected ('+arg[1]+')','System','Error']) }
});



ipcMain.on('updateData', (event,arg) => { // from serialManager
    // arg = dataCollection:Object
    // mainWindow.send('test',arg);
    if (mainWindow) mainWindow.webContents.send('updateData',arg);
});

ipcMain.on('disconnectModule', (event,arg) => { // from renderer
    // arg = moduleid
    var index = getIndex(arg);
    if (index===-1) return;
    serialManagers[index].webContents.send('disconnectModule',arg);
});
ipcMain.on('reconnectModule', (event,arg) => { // from renderer
    // arg = moduleid
    var index = getIndex(arg);
    if (index===-1) return;
    serialManagers[index].webContents.send('reconnectModule',arg);
});

ipcMain.on('registerItem', (event,arg) => { // from serialManager
    // arg = [type,uid,name,id,actValue,setValue,setMin,setMax,actMin,actMax,name,unit,true]
    defaultSettings.add(arg[1],arg[3],'recordValue',true);
    mainWindow.webContents.send('registerDataItems',arg);

});

ipcMain.on('foundUnworkedSerialport', (event,arg) => { // from renderer
    // arg = comPort
    serialPortsWorkedOn.push(arg);
});

ipcMain.on('identifiedSerialModule', (event,arg) => { // from renderer
    // arg = [comPort, uid, name, type, protocolVersion, firmwareVersion]
    defaultSettings.setModuleSettings(arg)
    serialModuleIds.push(parseInt(arg[1]));
    openSerialportWindow(arg);
});


ipcMain.on('getModules', (event, arg) => {
    event.returnValue = 'ok';
    if(mainWindow) mainWindow.webContents.send('getModules', serialPortsWorkedOn);
});


// Recorder message routing:

ipcMain.on('addRecorderEvent', (event, arg) => { // from renderer, always emitted when a log msg is to be displayed
    // arg = [msg, type]
    event.returnValue='ok';
    // the recorder has the settings and decides whether to use it or not
    if(recorderWindow) recorderWindow.webContents.send('addEvent',arg);        
});

ipcMain.on('recorderFatalError', (event, arg) => { // from recorder, fatal error, stopped recording
    // arg = true
    event.returnValue='ok';
    isRecording=false;
    mainWindow.webContents.send('recorderFatalError',true); // to update buttons and stuff
    // (log Msg is sent from recorder separatly)  
});

ipcMain.on('startRecording', (event, arg) => { // from renderer (record button clicked)
    // arg = undefined
    mainWindow.webContents.send('addLog',['start recording','Recorder',''])
    event.returnValue='ok';
    isRecording = true;
    if(recorderWindow) recorderWindow.send('startRecording'); else {
        mainWindow.webContents.send('addLog',['Error in start recording','Recorder','Error'])        
    }
});

ipcMain.on('recorderRequestsData', (event, arg) => { // from recorder, polling for data (for each module seperatly)
    // args = moduleId
    event.returnValue='ok';
    var index = getIndex(arg);
    if (index<0) return;
    if (mainWindow) mainWindow.send('recorderRequestsData',arg);
});

ipcMain.on('recorderSendData', (event, arg) => { // from renderer, back with data
    // args = dataManager.getRecorderData
    event.returnValue='ok';
    if (recorderWindow) recorderWindow.send('recorderData',arg);
});


ipcMain.on('recorderDataitems', (event, arg) => { // from renderer, immediatly ater btn-click
    // arg: dataManager.getDataItems
    event.returnValue = 'ok';
    if(recorderWindow) recorderWindow.webContents.send('recorderDataitems', arg);
});

ipcMain.on('recorderSettings', (event, arg) => { // from renderer, immediatly after btn-click
    event.returnValue = 'ok';
    if (recorderWindow) recorderWindow.webContents.send('recorderSettings', arg);
});


ipcMain.on('stopRecording', (event, arg) => { // from renderer (stop button clicked)
    // args = undefined
    mainWindow.webContents.send('addLog',['stop recording','Recorder',''])
    event.returnValue='ok';
    isRecording = false;
    if (recorderWindow) recorderWindow.send('stopRecording');
});

// Module settings routing:

ipcMain.on('enableChanged', (event, arg) => { // from renderer (module settings)
    // args = [moduleId, itemId, bool enabled]
    event.returnValue='ok';
    var index = getIndex(arg[0]);
    if (index<0) return;
    if (serialManagers[index]) serialManagers[index].webContents.send('enableChanged',arg);
});


ipcMain.on('changeModuleName', (event, arg) => { // from renderer (module settings)
    // args = [moduleId, newModuleName]
    event.returnValue='ok';
    var index = getIndex(arg[0]);
    if (index<0) return;
    if (serialManagers[index]) serialManagers[index].webContents.send('changeModuleName',arg);
});

ipcMain.on('changedModuleName', (event, arg) => { // from a serial Manager after new name was sent successfully
    // args = [moduleId, newModuleName]
    mainWindow.webContents.send('addLog',['changed Modulename to '+arg[1],'Modules',''])
    
    event.returnValue='ok';
    var index = getIndex(arg[0]);
    if (index<0) return;
    if (mainWindow) mainWindow.webContents.send('changedModuleName',arg);
});



ipcMain.on('changedModuleSettings', (event, arg) => { // from renderer (module settings)
    // args = {moduleId, pollinterval]
    
    event.returnValue='ok';
    var index = getIndex(parseInt(arg[0]));
    if (index<0) return;
    try {
        if (serialManagers[index]) serialManagers[index].webContents.send('changeModuleSettings',arg);
    } catch(err){
        // nothing; this happens when the window closes just after the if-statement
    }
});

ipcMain.on('changedSetValueByUser', (event, arg) => { // from renderer 
    // args = {moduleId, itemId, value]
    event.returnValue='ok';
    var index = getIndex(parseInt(arg[0]));
    if (index<0) return;
    try {
        if (serialManagers[index]) serialManagers[index].webContents.send('changeSetValueFromMain',arg);
    } catch(err){
        // nothing to catch; this happens when the window closes just after the if-statement
    }
});

// item settings:
ipcMain.on('setupAIOChannel', (event, arg) => { // from renderer 
    // args = {moduleId, itemId, name, setmin, setmax, actmin, actmax, unit]
    mainWindow.webContents.send('addLog',['changed AIO '+arg[2],'Modules',''])
    
    event.returnValue='ok';
    var index = getIndex(parseInt(arg[0]));
    if (index<0) return;
    if (serialManagers[index]) serialManagers[index].webContents.send('setupAIOChannel',arg);
});

ipcMain.on('setupAIChannel', (event, arg) => { // from renderer 
    // args = {moduleId, itemId, name, actmin, actmax, unit]
    mainWindow.webContents.send('addLog',['changed AI '+name,'Modules',''])
    event.returnValue='ok';
    var index = getIndex(parseInt(arg[0]));
    if (index<0) return;
    if (serialManagers[index]) serialManagers[index].webContents.send('setupAIChannel',arg);
});




function openSerialportWindow(arg){
    // arg = [comPort, uid, name, type, protocolVersion, firmwareVersion]
    var showDevTools = true;
    if (production===true) showDevTools = false;
    serialManagers.push(new BrowserWindow({
        width: 160,
        height: 60,
        webPreferences: {'devTools': showDevTools},
        frame: false,
        show: showDevTools,
        icon: path.join(__dirname,'assets','icons','png','icon.png'),
        title: 'serialWorker|'+arg[0]+'|'+arg[1]+'|'+arg[2]+'|'+arg[3]+'|'+arg[4]+'|'+arg[5],
        titleBarStyle: 'hidden'
    }));
    var index = serialManagers.length-1;
    if(arg[0].startsWith('vCOM')){
        serialManagers[index].loadURL(url.format({
            pathname: path.join(__dirname,'vModules.html'),
            protocol: 'file:',
            slashes: true
        }));        
    } else {
        serialManagers[index].loadURL(url.format({
            pathname: path.join(__dirname,'serialManager.html'),
            protocol: 'file:',
            slashes: true
        }));
    }
}



const mainMenuTemplate = [
    {
        label:'File',
        submenu:[
            {
                label: 'System Info',
                click(){
                    createSystemInfoWindow();
                }
            },
            {
                label: 'Quit',
                accelerator: process.platform == 'darwin' ? 'Command+Q' : 'Ctrl+Q',
                click(){
                    app.quit();
                }
            }
        ]
    }
];

// fix MAC issue on menu:
if(process.platform=='darwin') {mainMenuTemplate.unshift({})};

// add devTools
mainMenuTemplate.push({
    label: 'Developer Tools',
    submenu: [{
        label: 'Toggle DevTools',
        accelerator: process.platform == 'darwin' ? 'Command+T' : 'Ctrl+T',
        click(item,focusedWindow){
            focusedWindow.toggleDevTools();
        },
    },
    {
        role: 'reload'
    }]
})

function getScriptIndex(id){
    var index=-1;
    for (var i=0;i<scriptObj.length;i++){
        if (id===scriptObj[i].id) {index = i; break; }
    }
    return index
}



ipcMain.on('createNewEditor', (event,arg) => { // from renderer
    // arg = true
    var index = scriptObj.length;
    var id=0;
    for (var i=0;i<scriptObj.length;i++) {
        if (scriptObj[i].id>id) id=scriptObj[i].id;
    }
    var newId = id+1;
    scriptObj.push([]);
    scriptObj[index].id=newId;
    scriptObj[index].scriptRunner = null;
    scriptObj[index].isRunning = false;
    scriptObj[index].code = '';
    scriptObj[index].name = 'untitled.js';
    scriptObj[index].dataitems = [];
    scriptObj[index].isDocked = false;

    openNewEditor(newId,'untitled.js');
});

function openNewEditor(id,name){
    var showDevTools = true;
    var index = getScriptIndex(id);
    if (production===true) showDevTools = false;
    scriptObj[index].editor = new BrowserWindow({
        width: Settings.get('editorWindow.width'),
        height: Settings.get('editorWindow.height'),
        x: Settings.get('editorWindow.x'),
        y: Settings.get('editorWindow.y'),
        webPreferences: {'devTools': showDevTools},
        frame: false,
        show: true,
        icon: path.join(__dirname,'assets','icons','png','icon.png'),
        title: name+' - Javascript Editor|'+id,
        titleBarStyle: 'hidden'
    });

    scriptObj[index].editor.loadURL(url.format({
        pathname: path.join(__dirname,'editor.html'),
        protocol: 'file:',
        slashes: true
    }));
    scriptObj[index].editor.on('close', function(){
        scriptObj[index].editor = null;
    })
}

ipcMain.on('requestScriptFunctions', (event,arg) => { // from an editor window, after loading
    // arg = scriptId
    mainWindow.webContents.send('requestScriptFunctions',arg);
});

ipcMain.on('transmitScriptFunctions', (event,arg) => { // from the renderer, answering requestScriptFunctions
    // arg = [scriptId, dataManager.dataitems]
    var index = getScriptIndex(arg[0]); 
    if (index<0) return;
    // in this call, we add names of already docked scripts, to prevent overwriting
    // them when "updating" scripts from the editor to the main window
    var names = [];
    for (var i=0;i<scriptObj.length;i++){
        if (scriptObj[i].isDocked) names.push(scriptObj[i].name)
    }
    if (scriptObj[index].editor) scriptObj[index].editor.webContents.send('transmitScriptFunctions',[arg[1],names]);
});

ipcMain.on('scriptDockScript', (event,arg) => { // from an editor
    // arg = [scriptId, scriptCode, scriptName]
    // this is a new script:
    var index = scriptObj.length;
    var id=0;
    for (var i=0;i<scriptObj.length;i++) {
        if (scriptObj[i].id>id) id=scriptObj[i].id;
    }
    var newId = id+1;
    scriptObj.push([]);
    scriptObj[index].id=newId;
    scriptObj[index].scriptRunner = null;
    scriptObj[index].isRunning = false; 
    scriptObj[index].code = arg[1];
    scriptObj[index].name = arg[2];
    scriptObj[index].dataitems = [];
    scriptObj[index].isDocked = true;
    
    if (mainWindow) mainWindow.webContents.send('scriptDockScript',[newId,arg[1],arg[2]]);
});

ipcMain.on('runScript', (event,arg) => { // from renderer or editor
    // arg = [scriptId, scriptCode, scriptName, dataitems]
    var index = getScriptIndex(arg[0]); if (index<0) return;
    if (!arg[2]) { // came from renderer, we have to populate scriptCode and scriptName
        arg[1] = scriptObj[index].code;
        arg[2] = scriptObj[index].name;
    }
    scriptObj[index].isRunning=true;
    scriptObj[index].dataitems = arg[3];
    if(arg[1]) scriptObj[index].code = arg[1]; // these are null if this command comes from the renderer
    if(arg[2]) scriptObj[index].name = arg[2];
    if (mainWindow) mainWindow.webContents.send('changedScriptRunningStatus',[arg[0],true]);
    if (mainWindow) mainWindow.webContents.send('addLog',['Script '+arg[2]+' started','Script','Info']);
    
    openNewScriptRunner(arg[0],arg[2]);
})

function openNewScriptRunner(id,name){
    // args = [scriptId, editorId, scriptCode, scriptName, standBy or run]
    var showDevTools = true;
    var index = getScriptIndex(id); if (index<0) return;    
    if (production===true) showDevTools = false;
    scriptObj[index].scriptRunner = new BrowserWindow({
        width: Settings.get('editorWindow.width'),
        height: Settings.get('editorWindow.height'),
        x: Settings.get('editorWindow.x'),
        y: Settings.get('editorWindow.y'),
        webPreferences: {'devTools': showDevTools},
        frame: false,
        show: showDevTools,
        icon: path.join(__dirname,'assets','icons','png','icon.png'),
        title: name+' - scriptunner|'+id,
        titleBarStyle: 'hidden'
    });
    if (showDevTools) scriptObj[index].scriptRunner.webContents.openDevTools()
        
    scriptObj[index].scriptRunner.loadURL(url.format({
        pathname: path.join(__dirname,'scriptRunner.html'),
        protocol: 'file:',
        slashes: true
    }));

    scriptObj[index].scriptRunner.on('close', function(){
        scriptObj[index].scriptRunner = null;
    })
}

ipcMain.on('readyToExecute', (event,arg) => { // from a scriptRunner
    // arg = scriptId
    var index = getScriptIndex(arg); if (index<0) return;
    var code = scriptObj[index].code
    var name = scriptObj[index].name
    var id = scriptObj[index].id
    var dataitems = scriptObj[index].dataitems
    var isEditor = false; if (scriptObj[index].editor) isEditor=true;
    if (scriptObj[index].scriptRunner) scriptObj[index].scriptRunner.webContents.send('executeScript',[id,code,name,dataitems,isEditor])
})

ipcMain.on('abortScript', (event,arg) => { // from an editor or renderer
    // arg = scriptId
    var index = getScriptIndex(arg); if (index<0) return;
    
    scriptObj[index].isRunning=false;
    if (mainWindow) mainWindow.webContents.send('changedScriptRunningStatus',[arg,false]);
    
    if (scriptObj[index].scriptRunner) scriptObj[index].scriptRunner.close();
    if (mainWindow) mainWindow.webContents.send('addLog',['script '+scriptObj[index].name+' aborted','Script','']);
});

ipcMain.on('scriptPrintLog', (event,arg) => { // from a scriptRunner
    // arg = [scriptId, msg]
    var index = getScriptIndex(arg[0]); if (index<0) return;
    
    if (mainWindow) mainWindow.webContents.send('addLog',[arg[1],'ScriptLog','']);
    if (scriptObj[index].editor) scriptObj[index].editor.webContents.send('scriptLog',[arg[0],arg[1]]);
});

ipcMain.on('reportScriptPosition', (event,arg) => { // from a scriptRunner
    // arg = [scriptId, function, functionArg, lineNr, 'start'/'end']
    var index = getScriptIndex(arg[0]); if (index<0) return;
    
    if (scriptObj[index].editor) scriptObj[index].editor.webContents.send('reportScriptPosition',arg);
});

ipcMain.on('checkForSkipSleep', (event,arg) => { // from a scriptRunner
    // arg = [scriptId, lineNr]
    var index = getScriptIndex(arg[0]); if (index<0) return;    
    if (!scriptObj[index].editor) {event.returnValue = false; return }

    if (scriptObj[index].editor) {
        scriptObj[index].editor.webContents.send('checkSkipSleep',arg);
        ipcMain.on('returnedSkipSleep', (event2,arg) => {
            event.returnValue = arg;
        });
    } else {
        event.returnValue = false;
    }
});

ipcMain.on('scriptException', (event,arg) => { // from an scriptRunner
    // arg = [scriptId, scriptName, err.stack]
    var index = getScriptIndex(arg[0]); if (index<0) return;
    
    if (mainWindow) mainWindow.webContents.send('scriptException',[arg[0],arg[1],arg[2]]);
    if (mainWindow) mainWindow.webContents.send('changedScriptRunningStatus',[arg[0],false]);
    
    if (scriptObj[index].editor) scriptObj[index].editor.webContents.send('scriptException',[arg[0],arg[2]]);
    if (keepScriptRunnersAlive===false && scriptObj[index].scriptRunner) scriptObj[index].scriptRunner.close();
    scriptObj[index].isRunning = false;
})

ipcMain.on('scriptFinished', (event,arg) => { // from a scriptRunner
    // arg = [scriptId, scriptName]
    var index = getScriptIndex(arg[0]); if (index<0) return;
    
    if (mainWindow) mainWindow.webContents.send('scriptFinished',[arg[0],arg[1]]);
    if (mainWindow) mainWindow.webContents.send('changedScriptRunningStatus',[arg[0],false]);
    
    if (scriptObj[index].editor) scriptObj[index].editor.webContents.send('scriptFinished',arg[0]);
    if (keepScriptRunnersAlive===false) scriptObj[index].scriptRunner.close();
    scriptObj[index].isRunning = false;
});

ipcMain.on('scriptFailed', (event,arg) => { // from a scriptRunner
     // arg = [scriptId, scriptName]
     var index = getScriptIndex(arg[0]); if (index<0) return;
     
     if (mainWindow) mainWindow.webContents.send('scriptFailed',[arg[0],arg[1]]);
     if (mainWindow) mainWindow.webContents.send('changedScriptRunningStatus',[arg[0],false]);
     
     if (scriptObj[index].editor) scriptObj[index].editor.webContents.send('scriptFailed',arg[0]);
     //scriptObj[arg[0]].scriptRunner.close();
     scriptObj[index].isRunning = false;
});

ipcMain.on('checkIfScriptIsRunning', (event,arg) => { // from an editor, periodically
    // arg = scriptId
    var index = getScriptIndex(arg); if (index<0) return;
    event.sender.send('isRunning',scriptObj[index].isRunning);
})

ipcMain.on('scriptChangedSetValue', (event,arg) => { // from a scriptRunner
    // arg = [scriptId, moduleName.itemName, value]
    if (mainWindow) mainWindow.webContents.send('scriptChangedSetValue',arg);
});

ipcMain.on('scriptRequestslastUpdate', (event,arg) => { // from a scriptRunner
    // arg = [scriptId, moduleName]
    if (mainWindow) {
        mainWindow.webContents.send('requestLastUpdate',arg);
        ipcMain.on('gotLastUpdate', (event2,arg) => {
            event.returnValue = arg;
        });
    } else {
        event.returnValue = null;
    }
});

ipcMain.on('scriptRequestsValue', (event,arg) => { // from a scriptRunner
    // arg = [scriptId, moduleName.itemName]
    if (mainWindow) {
        mainWindow.webContents.send('requestValue',arg);
        ipcMain.on('gotValue', (event2,arg) => {
            event.returnValue = arg;
        });
    } else {
        event.returnValue = null;
    }
});


ipcMain.on('updateDockedScript', (event,arg) => { // from an editor
    // arg = [scriptId, scriptCode, scriptName]
    var index = getScriptIndex(arg[0]); if (index<0) return;
    scriptObj[index].code = arg[1];
    scriptObj[index].name = arg[2];

    var sids = [];
    for (var i=0;i<scriptObj.length;i++) {sids.push(scriptObj[i].id)}

    Settings.set('ScriptIds',sids);
    Settings.set('Scripts.'+arg[0]+'.code',arg[1]);
    Settings.set('Scripts.'+arg[0]+'.name',arg[2]);

    mainWindow.webContents.send('updateDockedScript',[arg[0],arg[2]]);
});

ipcMain.on('recorderFromScript', (event,arg) => { // from a scriptRunner
    // arg = [msg, args]
    switch(arg[0]){
        case 'start':
            if (isRecording===false){
                isRecording = true;
                mainWindow.webContents.send('scriptRecording','start');
                event.returnValue = true;
            } else event.returnValue = false;
            break;
        case 'stop':
        if (isRecording===true){
                isRecording = false;
                mainWindow.webContents.send('scriptRecording','stop')
                event.returnValue = true;            
            } else event.returnValue = false;
            break;
        case 'isRunning':
            event.returnValue = isRecording;
            break;
        case 'setFilename':
            var p = arg[1].toString();
            var fn = arg[2].toString();
            if (fs.existsSync(p)) {
                var fullPath = path.join(p,fn);
                Settings.set('recorderFolder',path.dirname(fullPath));
                Settings.set('recorderFilename',path.basename(fullPath));
                event.returnValue = true;
            } else event.returnValue = false;
            break;
        case 'getFilename':
            event.returnValue = Settings.get('recorderFilename').toString();
            break;
        case 'getPath':
            event.returnValue = Settings.get('recorderFolder');
            break;
    }
})

ipcMain.on('scriptLoadSetpoints', (event,arg) => { // from a scriptRunner
    // arg = [scriptId, filename, path]
    if (mainWindow) {
        mainWindow.webContents.send('scriptLoadsSetpoints',[arg[1],arg[2],arg[0]]);
        ipcMain.on('setpointsLoaded', (event2,arg2) => {
            // arg2 = bool success
            event.returnValue = arg2;
        });
    } else {
        event.returnValue = false;
    }
});

ipcMain.on('scriptSavesSetpoints', (event,arg) => { // from a scriptRunner
    // arg = [scriptId, filename, path]
    if (mainWindow) {
        mainWindow.webContents.send('scriptSavesSetpoints',[arg[1],arg[2],arg[0]]);
        ipcMain.on('setpointsSaved', (event2,arg2) => {
            // arg2 = bool success
            event.returnValue = arg2;
        });
    } else {
        event.returnValue = false;
    }
});


ipcMain.on('editScript', (event,arg) => { // from renderer
    // arg = scriptId
    var index = getScriptIndex(arg); if (index<0) return;    
    openNewEditor(arg,scriptObj[index].name);
});

ipcMain.on('requestScriptArgs', (event,arg) => { // from an editor window, after loading
    // arg = scriptId
    var index = getScriptIndex(arg); if (index<0) return;
    
    if (scriptObj[index].editor) scriptObj[index].editor.webContents.send('transmitScriptArgs',[arg,scriptObj[index].code,scriptObj[index].name,scriptObj[index].isDocked]);
    
    mainWindow.webContents.send('requestScriptArgs',arg);
});


ipcMain.on('closeEditor', (event,arg) => { // from an editor
    // arg = scriptId
    var index = getScriptIndex(arg); if (index<0) return;
    
    scriptObj[index].editor=null;
    event.returnValue = true;
});

ipcMain.on('removedDockedScript', (event,arg) => { // from an editor
    // arg = scriptId
    var index = getScriptIndex(arg); if (index<0) return;  
    scriptObj.splice(index,1);

    // update Settings:
    if (Settings.has('Scripts.'+arg+'.code')) Settings.delete('Scripts.'+arg+'.code');
    if (Settings.has('Scripts.'+arg+'.name')) Settings.delete('Scripts.'+arg+'.name');
    if (Settings.has('Scripts.'+arg)) Settings.delete('Scripts.'+arg);
    
    var ids = [];
    for (var i=0;i<scriptObj.length;i++) ids.push(scriptObj[i].id)
    Settings.set('ScriptIds',ids);

});

ipcMain.on('rendererDockedAScript', (event,arg) => {
    // arg = [scriptId,scriptCode,scriptName]
    var index = getScriptIndex(arg[0]);
    if (index<0){ // new script (from renderer at init via settings)
        index = scriptObj.length;
        scriptObj.push([]);
        scriptObj[index].id = parseInt(arg[0]);
        scriptObj[index].scriptRunner = null;
        scriptObj[index].isRunning = false;
        scriptObj[index].code = arg[1];
        scriptObj[index].name = arg[2];
        scriptObj[index].dataitems = [];    
        scriptObj[index].isDocked = true;    
    } else { // from an editor, scriptObj was already created
        scriptObj[index].code = arg[1];
        scriptObj[index].name = arg[2];
        scriptObj[index].isDocked = true;    
    }
        
        
    // update Settings:
    var ids = [];
    for (var i=0;i<scriptObj.length;i++) ids.push(scriptObj[i].id)
    Settings.set('ScriptIds',ids);
    Settings.set('Scripts.'+arg[0]+'.name',arg[2]);
    Settings.set('Scripts.'+arg[0]+'.code',arg[1]);    
});