const URL_DRONE_POSITIONS = "https://assignments.reaktor.com/birdnest/drones";
const URL_PILOT_INFO = "https://assignments.reaktor.com/birdnest/pilots/";

// nest zone (in millimeters)
const NESTZONE = {
    POSX: 250000,
    POSY: 250000,
    RADIOUS: 100000
};

// error codes
const ERROR = {
    DB_ACCESS: "ERROR: DataBase access error",
    DB_DELETE_PILOT: "ERROR: DataBase delete pilot error",
    FETCH_PILOT: "ERROR: Fetch pilot info error",
    FETCH_DRONES: "ERROR: Fetch drone positions error"
};
// remove pilots after 10 minutes (in milliseconds)
const PILOT_TIME_OUT = 10*60*1000;

// remove time stamps after 10 minutes (in milliseconds)
// client doesn't have to be reload page if connection is lost for short period.
const TIME_STAMP_TIME_OUT = 10*60*1000;

// data update rate (in milliseconds)
const UPDATE_TIME = 2000;

// xml to json 
const { parseString } = require("xml2js");

// server-client connection
const express = require('express');

// firebase as web hosting provider
const functions = require('firebase-functions');
const admin = require('firebase-admin');

// front end is in views folder
const engines = require('consolidate');
var hbs = require('handlebars');
const app = express();
app.engine('hbs',engines.handlebars);
app.set('views','./views');
app.set('view engine','hbs');

// limit trasfer size
app.use(express.json({ limit: '1mb' }));

// init firebase web hosting
admin.initializeApp(functions.config().firebase);



// toBeRemovedPilots stores pilot info
// key = drone serial number
// data = {
//    firstName:
//    lastName: 
//    email: 
//    phoneNumber:
//    timeOfLastViolation: 
//}
const toBeRemovedPilots = new Map();

// promisedPilots strores drone serial numbers while loading is in progress
// key = drone serial number
// data = timeOfLastViolation
const promisedPilots = new Map();

// timeStampedPilots stores add updates for client
// key = time stamp
// data = drone serial number
const timeStampedPilots = new Map();

// timeStampedOldPilots stores remove updates for client
// key = time stamp
// data = {
//    firstName:
//    lastName: 
//    email: 
//    phoneNumber:
//    timeOfLastViolation: 
//}
const timeStampedOldPilots = new Map();

// when server updates toBeRemovedPilots, time increases
var currentTimeStamp = 0;


// check for fly zone violation
function isFlyZoneViolation(dronePosX, dronePosY) {
    return NESTZONE.RADIOUS >= Math.sqrt(
        Math.pow(dronePosX - NESTZONE.POSX, 2) + 
        Math.pow(dronePosY - NESTZONE.POSY, 2))
}

// return true if timeOut has passed since time
function isTimeOut(time, timeOut)
{
    // time currently minus time is larger than time out
    return (new Date().getTime() - time > timeOut);
}

// fetch drone positions and pilots to toBeRemovedPilots list
function fetchDrones()
{
    // fetch drone postions data
    fetch(URL_DRONE_POSITIONS, {
        method: 'GET'
    }).then((dronesResponse) => 
    {
        // get xml
        dronesResponse.text().then((xmlFile) => 
        {
            // parsing xml data to json
            var dronesInJsonFile;
            parseString(xmlFile, function (parserError, result) {
                dronesInJsonFile = result;
            });
            // get list of drones
            const droneList = dronesInJsonFile.report.capture[0].drone;
            // get time 
            const timeOfLastViolation = dronesInJsonFile.report.capture[0]['$'].snapshotTimestamp;
            var droneSerialNumber;
            droneList.forEach( (newDrone) => 
            {
                droneSerialNumber = newDrone.serialNumber[0];
                // if not violation, move to next drone
                if (!isFlyZoneViolation(newDrone.positionX[0], newDrone.positionY[0])) 
                    { return; }
                console.log("fetch drone:", droneSerialNumber);

                // check if pilot is not already in toBeRemovedPilots
                if(toBeRemovedPilots.has(droneSerialNumber)) {
                    // update time
                    const oldMap = toBeRemovedPilots.get(droneSerialNumber);
                    toBeRemovedPilots.set(droneSerialNumber, {
                        firstName: oldMap.firstName, 
                        lastName: oldMap.lastName,
                        email: oldMap.email,
                        phoneNumber: oldMap.phoneNumber,
                        timeOfLastViolation: timeOfLastViolation
                    });
                    console.log("Update drone:", droneSerialNumber);
                }
                else {
                    console.log("Add new drone:", droneSerialNumber);
                    // update/add to promisedPilots
                    promisedPilots.set(droneSerialNumber, timeOfLastViolation);
                }
            });
        }).catch((error) => {
            console.log(error);
        });
    }).catch((error) => {
        console.log(error);
    });
 }

 function handlePilotError(droneSerialNumber) 
 {
    const timeOfLastViolation = toBeRemovedPilots.get(droneSerialNumber).timeOfLastViolation;
    // if less than 10 min old request
    if (!isTimeOut(new Date(timeOfLastViolation).getTime(), PILOT_TIME_OUT)) {
        // pilot will be handled again in next interval
        promisedPilots.set(droneSerialNumber, timeOfLastViolation);
        toBeRemovedPilots.delete(droneSerialNumber);
    }
    else {
        toBeRemovedPilots.delete(droneSerialNumber);
    }
 }

// when promise settles, add pilot to  list 
function fetchPilot(droneSerialNumber) 
{
    // add to toBeRemovedPilots
    toBeRemovedPilots.set(droneSerialNumber, {
        timeOfLastViolation: promisedPilots.get(droneSerialNumber)
    });
    promisedPilots.delete(droneSerialNumber);
    //fetch new pilot info
    fetch(URL_PILOT_INFO + droneSerialNumber, {
        method: 'GET'
    }).then((pilotResponse) => 
    {
        // get json
        pilotResponse.json().then((pilotInfo) => 
        {
            // update toBeRemovedPilots
            toBeRemovedPilots.set(droneSerialNumber, {
                firstName: pilotInfo.firstName, 
                lastName: pilotInfo.lastName,
                email: pilotInfo.email,
                phoneNumber: pilotInfo.phoneNumber,
                timeOfLastViolation: toBeRemovedPilots.get(droneSerialNumber).timeOfLastViolation
            });
            const newTimeStamp =  new Date().getTime();
            if(timeStampedPilots.has(newTimeStamp)) {
                const oldTimeStampedPilots = timeStampedPilots.get(newTimeStamp);
                oldTimeStampedPilots.add(droneSerialNumber);
                timeStampedPilots.set(newTimeStamp, oldTimeStampedPilots);
            }
            else {
                const pilot = new Set();
                pilot.add(droneSerialNumber);
                timeStampedPilots.set(newTimeStamp, pilot);
            }
            // update time stamp
            if ( currentTimeStamp < newTimeStamp ) {currentTimeStamp = newTimeStamp; }

            console.log("fetched drone:", droneSerialNumber);
        }).catch((error) => {
            console.log(error);
            // pilot will be handled again in next interval
            handlePilotError(droneSerialNumber);
        });
    }).catch((error) => {
        console.log(error);
        // pilot will be handled again in next interval
        handlePilotError(droneSerialNumber);
    });
}
function removeOldPilots() 
{
    // compere last violation to pilot time out time
    toBeRemovedPilots.forEach( (pilotInfo, droneSerialNumber) => 
    {
        if (isTimeOut(new Date(pilotInfo.timeOfLastViolation).getTime(), PILOT_TIME_OUT))
        {
            // remove from toBeRemovedPilots list
            toBeRemovedPilots.delete(droneSerialNumber);
  
            // update timeStampedPilots 
            timeStampedPilots.forEach((pilots, timeStamp) => {
                if (pilots.has(droneSerialNumber)){
                    pilots.delete(droneSerialNumber);
                    if (pilots.size == 0) {
                        timeStampedPilots.delete(timeStamp);
                    }
                }
            });
            // update timeStampedOldPilots 
            const newTimeStamp =  new Date().getTime();
            if(timeStampedOldPilots.has(newTimeStamp)) {
                const pilots = timeStampedOldPilots.get(newTimeStamp);
                pilots.add(pilotInfo);
                timeStampedOldPilots.set(newTimeStamp, pilots);
            }
            else {
                const pilots = new Set();
                pilots.add(pilotInfo);
                timeStampedOldPilots.set(newTimeStamp, pilots);
            }

            if ( currentTimeStamp < newTimeStamp ) {currentTimeStamp = newTimeStamp; }

            console.log("delete drone:", droneSerialNumber);
        }
    });
    // remove old timeStamps
    timeStampedOldPilots.forEach((pilotInfo, timeStamp) => 
    {
        if (isTimeOut(timeStamp, TIME_STAMP_TIME_OUT))
        {
            timeStampedOldPilots.delete(timeStamp);
        }
    })
}

// initial web request
app.get('/', (request,response) =>
{
    // get all pilots for client
    const pilotList = [];
    timeStampedPilots.forEach((pilots, timeOfLastViolation) => {
        pilots.forEach((droneSerialNumber) => {
            pilotList.push(toBeRemovedPilots.get(droneSerialNumber));
        });
    });
    const tranferData = {
        pilots: pilotList,
        timeStamp: currentTimeStamp
    }
    // send data
    response.render('index',{tranferData});

    console.log("Add pilots >>>>>>", tranferData.pilots)
});

// get time stamp from client, update client's pilot list and send new time stamp
app.post('/api', (request, response) => 
{
    const clientTimeStamp = request.body;

    // get pilots client is missing
    const pilotsToBeAdded = [];
    timeStampedPilots.forEach((pilots, timeOfLastViolation) => {
        if (clientTimeStamp < timeOfLastViolation) {
            pilots.forEach((droneSerialNumber) => {
                pilotsToBeAdded.push(toBeRemovedPilots.get(droneSerialNumber));
            });
        }
    });
    // get pilots that should be deleted from client
    const pilotsToBeRemoved = [];
    timeStampedOldPilots.forEach((pilots, timeOfLastViolation) => {
        if (clientTimeStamp < timeOfLastViolation) {
            pilots.forEach((pilotInfo) => {
                pilotsToBeRemoved.push(pilotInfo);
            });
        }
    });
    // send data
    response.json({
        addPilots: pilotsToBeAdded,
        removePilots: pilotsToBeRemoved,
        timeStamp: currentTimeStamp
    });
    console.log("Pilots to be removed (" + toBeRemovedPilots.size + 
        ")[" + timeStampedOldPilots.size +"] removed", pilotsToBeRemoved);
    console.log("Pilots to be added ("  + promisedPilots.size+ ") added", pilotsToBeAdded);
});

// fetch data every 2 seconds
setInterval( function () 
{
    // activate fetch promises for pilots
    promisedPilots.forEach((timeOfLastViolation, droneSerialNumber) => fetchPilot(droneSerialNumber));

    // fetch drone positions and drone serial numbers
    // if violated NDC add them to promisedPilots
    fetchDrones();

    // remove 10 min old pilots from timeStampedPilots and add them to timeStampedOldPilots list
    removeOldPilots();
    
    console.log("loop run");
},UPDATE_TIME);




exports.app = functions.https.onRequest(app);

