//'use strict';
const Settings = require('electron').remote.require('electron-settings')
const defaultSettings = require('./defaultSettings');
const fs = require('fs');
const {ipcRenderer, remote} = require('electron');
const path = require('path');
const {dialog} = require('electron').remote;
const loader = require('monaco-loader')

var editor;
var vlistitems = [];
var lastLineRead=0;

document.onreadystatechange = function () {
    if (document.readyState == "complete") {
        init();
    }
}


function init() {
    var win = remote.getCurrentWindow();
    var args = win.getTitle().split('|');
    var display = args[1];
    switch(display) {
        case 'settings':
        loader().then((monaco) => {
   
            editor = monaco.editor.create(document.getElementById('settings-monaco-editor'), {
              language: 'json',
              theme: 'vs',
              automaticLayout: true
           });
        var obj = document.getElementById('container-settings');
        var data = JSON.stringify(Settings.getAll(),null, 4);
        editor.setValue(data);
        console.log(data);
           
        document.getElementById('menu-settings').style.visibility="visible";
        obj.style.visibility="visible";
        document.getElementById('settings-monaco-editor').style.visibility = 'visible';
        });

        break;

        case 'info':
            document.getElementById('containerLoading').style.visibility="hidden";
            //document.getElementById('menu-info').style.visibility="visible"
            document.getElementById('container-info').style.visibility="visible";
        break;

    }

}

function closeWindow(){
    Settings.set('appSettingsWindow.x',window.screenX);
    Settings.set('appSettingsWindow.y',window.screenY);
    window.close();
}

window.addEventListener("resize", function (e) {
    Settings.set('appSettingsWindow.width',window.outerWidth);
    Settings.set('appSettingsWindow.height',window.outerHeight);
});




function updateSettings(){
    try {
        var data = editor.getValue();
        data = data.toString();
        var set = JSON.parse(data);
        Settings.setAll(set);
        status('Settings saved.')
    } catch (err) {
        status('Error ssaving Settings: '+err);
    }
}

function restoreSettings(){
    defaultSettings.clearSettings();
    defaultSettings.setDefaultSettings();
    var data = JSON.stringify(Settings.getAll(),null, 4);
    editor.setValue(data);
    status('Restored default factory settings.')
}



