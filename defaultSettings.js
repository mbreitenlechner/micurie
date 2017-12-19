var Settings = require('electron-settings');

var setModuleSettings = function(arg){
    // arg = [comPort, uid, name, type, protocolVersion, firmwareVersion]
    var id = arg[1];
    var name = arg[2];
    var type = arg[3];
    var protocolVersion = arg[4];
    var firmwareVersion = arg[5];
    id = id.toString();
    if (!Settings.has(id)) {
        var interval = Settings.get('defaultPollInterval.default'); 
        if (Settings.has('defaultPollInterval.'+type)) {
            interval = Settings.get('defaultPollInterval.'+type);
        }
        Settings.set(id+'.pollInterval', interval);
        
        Settings.set(id+'.name', name);
        Settings.set(id+'.protocolVersion', protocolVersion);
        Settings.set(id+'.firmwareVersion', firmwareVersion);
        Settings.set(id+'.saveInterval', 1000);
        Settings.set(id+'.display', 1);
        var modules = Settings.get('moduleIds');
        Settings.set(id+'.position',modules.length);
        modules.push(id);
        Settings.set('moduleIds',modules)
    }
}


var add = function(moduleID,id,name,value) {
    var name = name+'.'+moduleID.toString()+'.'+id.toString();
    //console.log('name:',name);
    Settings.set(name.toString(), value);
}

function setDefaultSetting(name,value){
    Settings.set(name, Settings.has(name) ? Settings.get(name) : value);
}

var clearSettings = function (){
    Settings.deleteAll();    
}

var setDefaultSettings = function(){

    setDefaultSetting('Window.height', 600);
    setDefaultSetting('Window.width', 1200);
    setDefaultSetting('Window.x', 10);
    setDefaultSetting('Window.y', 10);
    setDefaultSetting('Window.isMaximized', 0);
    setDefaultSetting('SerialPortSearchInterval', 500);
    setDefaultSetting('displayUpdateInterval', 20);
    setDefaultSetting('defaultPollInterval.default', 100);
    setDefaultSetting('defaultPollInterval.AIO8', 10);
    setDefaultSetting('defaultPollInterval.TC3',100); 
    setDefaultSetting('recorderFilename',"<year>-<month>-<day>-<hour>h<minute>m<second>s.h5"); 
    setDefaultSetting('recorderFolder',__dirname); 
    setDefaultSetting('recorderFileWriteInterval',60000);
    setDefaultSetting('recorderSaveSetpoints',1);
    setDefaultSetting('recorderSaveLogEvents',1);
    setDefaultSetting('recorderAutoNewFile',1);
    setDefaultSetting('recorderNewFileInterval',60);
    setDefaultSetting('setpointFolder',__dirname);
    setDefaultSetting('logFolder',__dirname);
    setDefaultSetting('logFile','log.txt');
    
    setDefaultSetting('editorWindow.height', 600);
    setDefaultSetting('editorWindow.width', 800);
    setDefaultSetting('editorWindow.x', 50);
    setDefaultSetting('editorWindow.y', 50);
    setDefaultSetting('editorWindow.isMaximized', 0);

    setDefaultSetting('appSettingsWindow.height', 600);
    setDefaultSetting('appSettingsWindow.width', 800);
    setDefaultSetting('appSettingsWindow.x', 50);
    setDefaultSetting('appSettingsWindow.y', 50);
    setDefaultSetting('appSettingsWindow.isMaximized', 0);

    setDefaultSetting('scriptPath',__dirname); 

    setDefaultSetting('scriptModule.display',1);
    setDefaultSetting('scriptModule.position',-1);
    
    setDefaultSetting('moduleIds',[]);
    
    
}

module.exports = {
    setModuleSettings : setModuleSettings,
    add : add,
    setDefaultSettings : setDefaultSettings,
    clearSettings: clearSettings
}


