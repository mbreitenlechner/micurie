/**
 * MICURIE Recorder functions 
 */  
declare namespace recorder { 
    /**
    * Returns if the recorder is currently running. 
    */  
    function isRunning(): boolean
    /**
    * Starts Recorder
    * returns true if successful started 
    */  
    function start(): boolean
    /**
    * Stops Recorder
    * returns true if successful stopped 
    */  
    function stop(): boolean
    /**
    * Retrieve the filename (without path)
    */  
    function getFilename(): String
    /**
    * Retrieve the path 
    */  
    function getPath(): String
    /**
    * Retrieve the filename (without path)
    * @param path on Windows: use \\ to escape \
    */  
    function setFilename(path: String, filename: String): void
}
/**
* pause Execution for a number of milliseconds
* @param milliseconds only integer values accepted 
*/  
declare function sleepMs(milliseconds: number): void
/**
* pause Execution for a number of seconds
* @param seconds only integer values accepted; consider sleepMS
*/  
declare function sleep(seconds: number): void
/**
* Log a message to the main window,
* to an editor window (if open),
* to the recorder if option is set and recorder is running
* and to the system log 
*/  
declare function log(message: String): void

/**
 * Save all current setpoints to and load from disk 
 */  
declare namespace setpoints {
    function loadSetpoints(filename: string, path?: string): boolean
    function saveSetpoints(filename: string, path?: string): boolean
    function getCurrentPath(): string
    function setCurrentPath(path: string): boolean
}

declare function sendEmail(from: string, to: string, subject: string, html: string ): boolean;

/**
 * Access Application Settings: better be careful with these
 */  
declare namespace settings {
    function set(key: string, value: string): boolean
    function get(key: string): any
    function has(key: string): boolean
    function deleteKey(key: string): boolean
}



