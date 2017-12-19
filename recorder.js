"use strict"

var Settings = require('electron').remote.require('electron-settings')
var hdf5 = require('hdf5').hdf5;
var h5lt = require('hdf5').h5lt;
var h5ds = require('hdf5').h5ds;
var h5tb = require('hdf5').h5tb;

var Access = require('hdf5/lib/globals').Access;
const fs = require('fs');

const {ipcRenderer, remote} = require('electron');
const path = require('path');

var settings = [];
var dataItems = [];
var processTime;
var makeNewFile = false;
var isRecording = false;
var filename = '';
var fileWriteTimer;
var FileInfo = [];

var dataTimers = [];

var startRecorderLocalString='';

var eventMsg = [];
var eventType = [];
var eventRelativeTime = [];
var eventLocalTimeString = [];

function recorderTimers(f, ms, arg) { 
    var id = setInterval(f, ms, arg); 
    return { 
       cancel : function() { 
          clearInterval(id); 
       } 
    }; 
}

ipcRenderer.on('addEvent', (event,arg) => {
    // arg = [msg, type]
    //console.log('got Event:',arg);
    addEvent(arg[0],arg[1]);
})

function addEvent(msg,type){
    if (msg.length>100) msg = msg.substr(0,97)+'...'; // we have to limit ourselves to 100 chars in length, see below
    if (isRecording===false) return;
    if (msg==='start recording' && type==='Recorder') return; // reason: we want to have a clear start, it's questionable if this comes before or after isRecording was set to true
    eventMsg.push(msg);
    eventType.push(type);

    var tmp = process.hrtime(processTime);
    var dt = tmp[0]+tmp[1]/1e9;
    eventRelativeTime.push(dt);

    var t = new Date();
    var minutes = t.getTimezoneOffset(); // that's in minutes
    var t2 = t.valueOf()-minutes*60000; // micoseconds from 1970, corrected by time zone offset
    var t3 = new Date(t2);
    var localString = t3.toISOString();
    localString = localString.replace(/[TZ]/g,' ');
    localString = localString.substr(0,localString.indexOf('.'));
    eventLocalTimeString.push(localString);

}

ipcRenderer.on('recorderData', (event, arg) => {
    var data = arg;

    var senderModuleId = data[0].moduleId;
    var sendTime = data[0].time;
    if (isRecording===true &&  FileInfo.dataIds['id'+senderModuleId].length>0){
        var tmp = process.hrtime(processTime);
        var dt = tmp[0]+tmp[1]/1e9;

        if (dt>settings.autoNewFileInterval*60 && settings.autoNewFile>0) {
            makeNewFile=true;
        }
        FileInfo.dataTimes['id'+senderModuleId].push(dt);
        // loop through everything we want to save, and check if data is there, add nan otherwise
        for (var i=0;i<FileInfo.dataIds['id'+senderModuleId].length;i++){
            var index=-1;
            for (var j=1;j<data.length;j++){
                if (data[j].id === FileInfo.dataIds['id'+senderModuleId][i]) { index=j; break; }
            }
            if (index>=0){
                FileInfo.dataBuffer['id'+senderModuleId][FileInfo.dataIds['id'+senderModuleId][i]].push(data[j].value);
            } else {
                FileInfo.dataBuffer['id'+senderModuleId][FileInfo.dataIds['id'+senderModuleId][i]].push(NaN);
            }
        }
    }
    event.returnValue = 'ok';
    if (makeNewFile===true){
        writeDataToFile(true);
        makeNewFile=false;
    }
});


ipcRenderer.on('recorderDataitems', (event, arg) => {
    event.returnValue = 'ok';
    dataItems = arg;
    if (settings.folder && dataItems.length>0) startRecording(false);
});

ipcRenderer.on('recorderSettings', (event, arg) => {
    event.returnValue = 'ok';
    settings = arg;
    filename = createFilename(settings.folder,settings.filename);
    console.log('got settings',filename);    
    if (settings.folder && dataItems.length>0) startRecording(false);
});


ipcRenderer.on('startRecording', (event, arg) => {
    event.returnValue = 'ok';        
    if (isRecording===true) return;
    dataItems = [];
});


ipcRenderer.on('stopRecording', (event, arg) => {
    stopRecording();
});


function startRecording(isrestart){
    console.log('start recording...');
    console.log('FileInfo = ',FileInfo);
    console.log('settings = ',settings);
    console.log('dataItems = ',dataItems);
    
    // todo: do some homework, like: path exists, filename=valid

    FileInfo.dataBuffer = [];
    FileInfo.dataTimes = [];
    FileInfo.dataIds = [];
    FileInfo.names = [];

    FileInfo.folders = [];
    FileInfo.moduleIds = [];

    for (var i=0;i<dataItems.length;i++){
        var item = dataItems[i];
        if (FileInfo.folders.indexOf(item.moduleName)===-1) FileInfo.folders.push(item.moduleName);
        if (FileInfo.moduleIds.indexOf(item.moduleUID)===-1) FileInfo.moduleIds.push(item.moduleUID);
    }        


    for (var j=0;j<FileInfo.moduleIds.length;j++){
        FileInfo.dataTimes['id'+FileInfo.moduleIds[j]] = [];
        FileInfo.dataBuffer['id'+FileInfo.moduleIds[j]] = [];
        FileInfo.dataIds['id'+FileInfo.moduleIds[j]] = [];
        FileInfo.names['id'+FileInfo.moduleIds[j]] = [];
        for (var i=0;i<dataItems.length;i++){
            if (dataItems[i].moduleUID!=FileInfo.moduleIds[j]) continue;
            var item = dataItems[i];
            switch(item.type){
                case 'AI':
                    FileInfo.dataBuffer['id'+item.moduleUID][item.itemID+'-act']=[];
                    FileInfo.dataIds['id'+FileInfo.moduleIds[j]].push(item.itemID+'-act');
                    FileInfo.names['id'+FileInfo.moduleIds[j]].push(item.itemName+'-act');
                    break
                case 'AIO':
                    FileInfo.dataBuffer['id'+item.moduleUID][item.itemID+'-act']=[];
                    FileInfo.dataBuffer['id'+item.moduleUID][item.itemID+'-set']=[];
                    FileInfo.dataIds['id'+FileInfo.moduleIds[j]].push(item.itemID+'-act');
                    FileInfo.dataIds['id'+FileInfo.moduleIds[j]].push(item.itemID+'-set');
                    FileInfo.names['id'+FileInfo.moduleIds[j]].push(item.itemName+'-act');
                    FileInfo.names['id'+FileInfo.moduleIds[j]].push(item.itemName+'-set');
                    break;
            }
        }
    }

    if (isrestart===true) filename = createFilename(settings.folder,settings.filename);

    FileInfo.filename = filename;

    
    try {
        var file = new hdf5.File(filename,Access.ACC_TRUNC);
    } catch(err) {
        var msg = err.message
        console.log(msg, filename);
        ipcRenderer.send('recorderFatalError',true)
        ipcRenderer.send('addLog',[msg,'Recorder','Error']);
        return
    }

    

    processTime = process.hrtime();
    var t = new Date();
    var minutes = t.getTimezoneOffset(); // that's in minutes
    var t2 = t.valueOf()-minutes*60000; // micoseconds from 1970, corrected by time zone offset
    var t3 = new Date(t2);
    var localString = t3.toISOString();
    localString = localString.replace(/[TZ]/g,' ');
    var UTCString = t.toISOString();
    UTCString = UTCString.replace(/[TZ]/g,' ');
    

    file['creationTimeUTCPrecise'] = UTCString;
    file['creationTimeLocalPrecise'] = localString;
    localString = localString.substr(0,localString.indexOf('.'));
    startRecorderLocalString = localString;
    UTCString = UTCString.substr(0,UTCString.indexOf('.'));
    file['creationTimeUTC'] = UTCString;
    file['creationTimeLocal'] = localString;
    file['creationTimeUnixTimestamp'] = t/1000;
    file['creationTimeMatlabTimeLocal'] = t3/(1000*24*3600)+719529;
    file['creationTimeMatlabTimeUTC'] = t/(1000*24*3600)+719529;
    
    try {
        file.flush();
    } catch(err) {
        var msg = err.message
        console.log(msg);
        ipcRenderer.send('recorderFatalError',true)
        ipcRenderer.send('addLog',[msg,'Recorder','Error']);
        file.close();
        return
    }

    for (var i=0;i<FileInfo.folders.length;i++){
        var group=file.createGroup(FileInfo.folders[i]);
        group.close();
    }

    if (settings.saveLogEvents===1){
        var group=file.createGroup('Log');
        group.close();
    }
    

    if (isrestart===false){
        isRecording = true;
        for (var i=0;i<FileInfo.moduleIds.length;i++){
            var interval = 1000;
            if (Settings.has(FileInfo.moduleIds[i]+'.saveInterval')) interval = Settings.get(FileInfo.moduleIds[i]+'.saveInterval');
            console.log('interval = ',interval);
            dataTimers[i] = recorderTimers(requestData,interval,FileInfo.moduleIds[i])
        }  
        fileWriteTimer = recorderTimers(writeDataToFile,settings.interval,false);
    }
      

}

function requestData(moduleId){
    ipcRenderer.send('recorderRequestsData',moduleId);
}

function stopRecording(){

    console.log('stop recording...')
    fileWriteTimer.cancel();
    
    writeDataToFile();
    isRecording = false;
    for (var i=0;i<FileInfo.moduleIds.length;i++){
        dataTimers[i].cancel();
    }


    FileInfo = [];
    settings = [];
    dataItems = [];

    eventMsg = [];
    eventType = [];
    eventRelativeTime = [];
    eventLocalTimeString = [];
}


function createFilename(folder,name){
    var filename = path.join(folder,name);
    var d = new Date();
    filename = filename.replace(/<year>/g,d.getFullYear().pad());
    filename = filename.replace(/<month>/g,(d.getMonth()+1).pad());
    filename = filename.replace(/<day>/g,d.getDate().pad());
    filename = filename.replace(/<hour>/g,d.getHours().pad());
    filename = filename.replace(/<minute>/g,d.getMinutes().pad());
    filename = filename.replace(/<second>/g,d.getSeconds().pad());

    var filesPresent = fs.readdirSync(path.dirname(filename));

    var counter=1;
    var newFilename=filename;
    while(filesPresent.indexOf(newFilename)>=0){
        newFilename = filename.substr(0,filename.lastIndexOf('.'))+'('+counter.toString()+').'+filename.substr(filename.lastIndexOf('.')+1);
        counter++;
    }

    return newFilename;
}

Number.prototype.pad = function(size) {
      var s = String(this);
      while (s.length < (size || 2)) {s = "0" + s;}
      return s;
    }

function writeDataToFile(restartNewFile){
    console.log("Writing to file...");
    if (isRecording===false) {console.log('isRecording is false, aborting.'); return}
    
    try {
        var file = new hdf5.File(FileInfo.filename,Access.ACC_RDWR);
    } catch(err) {
        var msg = err.message
        console.log(msg, filename);
        ipcRenderer.send('recorderFatalError',true)
        isRecording=false;
        ipcRenderer.send('addLog',[msg,'Recorder','Error']);
        return
        }
    
    
    // log:
    var dimY = eventMsg.length;
    if (settings.saveLogEvents===1 && dimY>0){
        try {
            var group = file.openGroup('Log');
        } catch(err) {
            var msg = err.message
            console.log(msg);
            isRecording = false;
            ipcRenderer.send('recorderFatalError',true)
            ipcRenderer.send('addLog',[msg,'Recorder','Error']);
            file.close();
            return
        }
        // since the length of strings are limited to the longest msg during the first write,
        // we add a start recording string manually here, with trailing spaces.
        // there's no other workaround possible for now.
        if (group.getDatasetType('log')===1){ // unknown
            var txt = 'start recording';
            while (txt.length<100) txt=txt+' ';
            eventMsg.unshift(txt);
            var txt = 'Recorder';
            while (txt.length<18) txt=txt+' ';
            eventType.unshift(txt);
            eventRelativeTime.unshift(0);
            eventLocalTimeString.unshift(startRecorderLocalString);
        }

        const tLogModel = new Array(4);
        
        //time:
        var x = new Float64Array(dimY);
        for (var k=0;k<dimY;k++){ x[k] = eventRelativeTime[k]; }
        x.name = 'relative time [s]';
        tLogModel[0] = x;

        //timeString:
        var x = new Array(dimY);
        for (var k=0;k<dimY;k++){ x[k] = eventLocalTimeString[k]; }
        x.name = 'local time';
        tLogModel[1] = x;
        
        //eventType:
        var x = new Array(dimY);
        for (var k=0;k<dimY;k++){ x[k] = eventType[k]; }
        x.name = 'event type';
        tLogModel[2] = x;

        //eventType:
        var x = new Array(dimY);
        for (var k=0;k<dimY;k++){ x[k] = eventMsg[k]; }
        x.name = 'event msg';
        tLogModel[3] = x;

        console.log(tLogModel);

        if (group.getDatasetType('log')===1){ // unknown
            console.log('making new dataset...');

            try {
                h5tb.makeTable(group.id, 'log', tLogModel);
            } catch(err) {
                var msg = err.message
                console.log(msg);
                isRecording = false;
                ipcRenderer.send('recorderFatalError',true)
                ipcRenderer.send('addLog',[msg,'Recorder','Error']);
                group.close(); file.close();                
                return
            }

        }
        else {
            console.log('dataset exists, appending....');
            try {
                h5tb.appendRecords(group.id, 'log', tLogModel);
            } catch(err) {
                var msg = err.message
                console.log(msg);
                isRecording=false
                ipcRenderer.send('recorderFatalError',true)
                ipcRenderer.send('addLog',[msg,'Recorder','Error']);
                group.close(); file.close();                
                return
            }
        }
        group.close();
        
    }    
    
    // todo: handle errors here
    for (var i=0;i<FileInfo.folders.length;i++){
        try {
            var group = file.openGroup(FileInfo.folders[i]);
        } catch(err) {
            var msg = err.message
            console.log(msg);
            isRecording = false;
            ipcRenderer.send('recorderFatalError',true)
            ipcRenderer.send('addLog',[msg,'Recorde','Error']);
            file.close();
            return
        }

        var id = 'id'+FileInfo.moduleIds[i];
        var dimY = FileInfo.dataBuffer[id][FileInfo.dataIds[id][0]].length;
        var dimX = FileInfo.dataIds[id].length;

        if (dimY===0) { file.close(); continue; }

        //calculate dimension:
        var counter=1; // this is for the time column
        for (var j=0;j<dimX;j++){
            var tmp = FileInfo.dataIds[id][j].split('-');
            var suffix = tmp[1];
            if (settings.saveSetpoints===1 || suffix!=='set') counter++;
        }
        const tModel = new Array(counter);

        //time:
        var x = new Float64Array(dimY);
        for (var k=0;k<dimY;k++){
            x[k] = FileInfo.dataTimes[id][k];
        }
        x.name = 'relative time [s]';
        tModel[0] = x;

        //data:
        var counter=1;
        for (var j=0;j<dimX;j++){
            var x = new Float64Array(dimY);
            for (var k=0;k<dimY;k++){
                x[k] = FileInfo.dataBuffer[id][FileInfo.dataIds[id][j]][k];
            }
            x.name = FileInfo.names[id][j];
            var tmp = FileInfo.dataIds[id][j].split('-');
            var suffix = tmp[1];
            //console.log('saveSetpoints =',settings.saveSetpoints);
            if (settings.saveSetpoints===1 || suffix!=='set'){
                //console.log(counter);
                tModel[counter] = x;
                counter++;
            }


        }

        if (group.getDatasetType('data')===1){ // unknown
            console.log('making new dataset...'); 
            try {    
                h5tb.makeTable(group.id, 'data', tModel);
            } catch(err) {
                var msg = err.message
                console.log(msg);
                isRecording = false;
                ipcRenderer.send('recorderFatalError',true)
                ipcRenderer.send('addLog',[msg,'Recorder','Error']);
                group.close(); file.close();                
                return
            }
        }
        else {
            console.log('dataset exists, appending....');
            try {
                h5tb.appendRecords(group.id, 'data', tModel);
            } catch(err) {
                var msg = err.message
                console.log(msg);
                isRecording = false;
                ipcRenderer.send('recorderFatalError',true)
                ipcRenderer.send('addLog',[msg,'Recorder','Error']);
                group.close(); file.close();
                return
            }
        }
        group.close();
    }
    file.close();

    //clear events:
    eventMsg = [];
    eventType = [];
    eventRelativeTime = [];
    eventLocalTimeString = [];

    //clear databuffer:
    for (var j=0;j<FileInfo.moduleIds.length;j++){
        FileInfo.dataTimes['id'+FileInfo.moduleIds[j]] = [];
        for (var i=0;i<dataItems.length;i++){
            if (dataItems[i].moduleUID!=FileInfo.moduleIds[j]) continue;
            var item = dataItems[i];
            switch(item.type){
                case 'AI':
                    FileInfo.dataBuffer['id'+item.moduleUID][item.itemID+'-act']=[];
                    break
                case 'AIO':
                    FileInfo.dataBuffer['id'+item.moduleUID][item.itemID+'-act']=[];
                    FileInfo.dataBuffer['id'+item.moduleUID][item.itemID+'-set']=[];
                    break;
            }
        }
    }
    if(restartNewFile===true) startRecording(true);
}