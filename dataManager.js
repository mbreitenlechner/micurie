

class dataManager{
    constructor(dataItems){
        this.dataItems = dataItems;

        this.getValue = function(moduleUID,itemID,varName){
            var index = this.dataItems.findIndex(dataItems=>dataItems.fullId==moduleUID+'-'+itemID);

            if (index<0) return false;
            return this.dataItems[index][varName];
        }

        this.setValue = function(moduleUID,itemID,varName,value){
            var index = this.dataItems.findIndex(dataItems=>dataItems.fullId===moduleUID+'-'+itemID);
            
            if (index<0) {console.log('dataValue not found:',moduleUID,itemID,varName,value); return false; }
            //if (varName==="actValue" && parseInt(itemID)===1) console.log('dataManager:',moduleUID,itemID,varName,value);
            this.dataItems[index][varName] = value;
            if (varName==='actValue') {
                var now = Date.now();
                //this.dataItems[index].updateRate = 1/((now-this.dataItems[index].lastUpdate)/1000); // Hz
                this.dataItems[index].lastUpdate = now;
            }
            return true;
        }

        this.getModuleName = function(moduleId){
            for(var i=0;i<this.dataItems.length;i++){
                if (moduleId===this.dataItems[i].moduleUID) return this.dataItems[i].moduleName; 
            }
            return null;
        }

        this.updateModuleNames = function(moduleId,newName){
            for (var i=0;i<this.dataItems.length;i++){
                if(parseInt(this.dataItems[i].moduleUID)===parseInt(moduleId)) this.dataItems[i].moduleName = newName;
            }  
        }

        this.getModuleUIDs = function(){
            var modules = [];
            for (var i=0;i<this.dataItems.length;i++){
                var item = this.dataItems[i];
                if (modules.indexOf(item.moduleUID)===-1) modules.push(item.moduleUID);
            }
            return modules;
        }
        this.getDataItems = function(){ // for recorder
            // todo: check for unique folder names!
            var data = [];
            var item;
            for (var i=0;i<this.dataItems.length;i++){
                item = this.dataItems[i];
                if (item.recordValue==true) {
                    data[i] = item;
                }
            }
            return data;
        }

        this.getAllDataItems = function(){
            var data = [];
            var item;
            for (var i=0;i<this.dataItems.length;i++){
                item = this.dataItems[i];
                data[i] = item;
            }
            return data;
        }

        this.onTimeout = function(moduleId){
            var item;
            for (var i=0;i<this.dataItems.length;i++){
                item = this.dataItems[i];
                if (moduleId!==item.moduleUID) continue;
                switch(item.type){
                    case 'AIO':
                        this.dataItems[i].actValue = 'NaN';
                        break;
                    case 'AI':
                        this.dataItems[i].actValue = 'NaN';
                        break;
                }
            }      
        } 

        this.getRecorderData = function(ModuleId){
            var data = [];
            data.push({'time':Date.now(),'moduleId':ModuleId});
            var item;
            for (var i=0;i<this.dataItems.length;i++){
                item = this.dataItems[i];
                if (item.recordValue==true && item.moduleUID==ModuleId) { 
                    switch(item.type){
                        case 'AIO':
                            if (item.actValue=="NaN") 
                                data.push({'id':item.itemID+'-act','value':'NaN'});
                            else
                                data.push({'id':item.itemID+'-act','value':item.actValue});
    
                            data.push({'id':item.itemID+'-set','value':item.setValue});
                            break;
                        case 'AI':
                            data.push({'id':item.itemID+'-act','value':item.actValue});
                            break;
                    }
                }
            }
            return data;        
        }

        this.registerAI = function(ModuleType,moduleUID,moduleName,itemID,actValue,actMin,actMax,itemname,unit,recordValue,enabled){
            var index = -1;
            for (var i=0;i<dataItems.length;i++){
                if (moduleUID===this.dataItems[i].moduleUID && itemID===this.dataItems[i].itemID) {index=i; break;}
            }
            if (index<0) { this.dataItems.push([]); index = this.dataItems.length-1; }
            
            var diff = actMax-actMin;
            var l = Math.floor(Math.log10(diff));
            var numberFormatAct = '.toFixed('+(4-l).toString()+')';
            if (actMax>1e5) numberFormatAct = '.toExponential(5)';
            if (l<(-3)) numberFormatAct = '.toExponential(5)';
            if (ModuleType=="TC3") numberFormatAct = '.toFixed(2)';
            //console.log(numberFormatAct);

            //avoid non-unique itemNames within a module (problems with recording and scripting...)
            var name=itemname.replace(/([^_a-z0-9]+)/gi, '_');
            var namesPresent = [];
            for (var i=0;i<dataItems.length;i++) {
                if (index===i) continue;
                if (dataItems[i].moduleUID!==moduleUID) continue;
                namesPresent.push(dataItems[i].itemName);
            }
            var newName = name; var counter=1;
            while(namesPresent.indexOf(newName)>=0) {
                newName=name+'-'+counter.toString();
                counter=counter+1;
            }
            name=newName;
            
            this.dataItems[index] = {
                'fullId': moduleUID+'-'+itemID,
                'moduleUID': moduleUID,
                'moduleName': moduleName,
                'type': 'AI',
                'itemID': itemID,
                'itemName': name,
                'actMin': actMin,
                'actMax': actMax,
                'actValue': actValue,
                'unit': unit,
                'lastUpdate': Date.now(),
                'actFormat': numberFormatAct,
                'recordValue': recordValue,
                'enabled': enabled
            }
            //console.log(this.dataItems[index].moduleName,this.dataItems.length);
        }

        this.registerAIO = function(ModuleType,moduleUID,moduleName,itemID,actValue,setValue,setMin,setMax,actMin,actMax,itemname,unit,recordValue,enabled){
            var index = -1;
            for (var i=0;i<dataItems.length;i++){
                if (moduleUID===this.dataItems[i].moduleUID && itemID===this.dataItems[i].itemID) {index=i; break;}
            }
            if (index<0) { this.dataItems.push([]); index = this.dataItems.length-1; }
            
            var diff = actMax-actMin;
            var l = Math.floor(Math.log10(diff));
            var numberFormatAct = '.toFixed('+(4-l).toString()+')';
            if (actMax>1e5) numberFormatAct = '.toExponential(5)';
            if (l<(-3)) numberFormatAct = '.toExponential(5)';

            var diff = setMax-setMin;
            var l = Math.floor(Math.log10(diff));
            var numberFormatSet = '.toFixed('+(4-l).toString()+')';
            if (setMax>1e5) numberFormatSet = '.toExponential(5)';
            if (l<(-3)) numberFormatSet = '.toExponential(5)';
            //console.log(numberFormatAct);
            
            //avoid non-unique itemNames within a module (problems with recording and scripting...)
            var name=itemname.replace(/([^_a-z0-9]+)/gi, '_');
            var namesPresent = [];
            for (var i=0;i<dataItems.length;i++) {
                if (index===i) continue;
                if (dataItems[i].moduleUID!==moduleUID) continue;
                namesPresent.push(dataItems[i].itemName);
            }
            var newName = name; var counter=1;
            while(namesPresent.indexOf(newName)>=0) {
                newName=name+'-'+counter.toString();
                counter=counter+1;
            }
            name=newName;
            
            this.dataItems[index] = {
                'fullId': moduleUID+'-'+itemID,
                'moduleUID': moduleUID,
                'moduleName': moduleName,
                'type': 'AIO',
                'itemID': itemID,
                'itemName': name,
                'actMin': actMin,
                'actMax': actMax,
                'setMin': setMin,
                'setMax': setMax,
                'setValue': setValue,
                'actValue': actValue,
                'unit': unit,
                'lastUpdate': Date.now(),
                'actFormat': numberFormatAct,
                'setFormat': numberFormatSet,
                'recordValue': recordValue,
                'enabled': enabled
            }
            //console.log(this.dataItems[index])
        }
    }
}




module.exports = {
    data : new dataManager([])
}


