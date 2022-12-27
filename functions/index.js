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
// remove pilots in 10 minutes (in milliseconds)
const PILOT_TIME_OUT = 10*60*1000;

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

// Pilots that are to be added and removed in the next request.
const newPilotsClient = new Set();
const oldPilotsClient = new Set();

// to be added, when fully loaded
// key = drone serial number
// data = timeOfLastViolation
const promisedPilots = new Map();

// pilots to be removed from server and client's list after 10 minutes
// key = drone serial number
// data = {
//    firstName:
//    lastName: 
//    email: 
//    phoneNumber:
//    timeOfLastViolation: 
//}
const toBeRemovedPilots = new Map();

// get pilot list for client
function getPilotList(){
    const pilotList = new Set();
    toBeRemovedPilots.forEach((pilotInfo, droneSerialNumber) => 
    {
        pilotList.add({
            firstName: decodeURI(pilotInfo.firstName), 
            lastName: decodeURI(pilotInfo.lastName),
            email: decodeURI(pilotInfo.email),
            phoneNumber: pilotInfo.phoneNumber
        });
    });
    return pilotList;
}

// check for fly zone violation
function isFlyZoneViolation(dronePosX, dronePosY) {
    return NESTZONE.RADIOUS >= Math.sqrt(
        Math.pow(dronePosX - NESTZONE.POSX, 2) + 
        Math.pow(dronePosY - NESTZONE.POSY, 2))
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
                console.log("fetched drones, drone:", droneSerialNumber);

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
                }
                else if (!promisedPilots.has(droneSerialNumber)) {
                    promisedPilots.set(droneSerialNumber, timeOfLastViolation);
                }
                else {
                    // update list 
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
    if (!isTimeOut(timeOfLastViolation)) {
        // pilot will be handled again in next interval
        promisedPilots.set(droneSerialNumber, timeOfLastViolation);
        toBeRemovedPilots.delete(droneSerialNumber);
    }
 }

// when promise settles, add pilot to newPilotsClient list 
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
            console.log("database read for add command, drone:", droneSerialNumber);
            // add pilot to client's list
            newPilotsClient.add({
                firstName: pilotInfo.firstName, 
                lastName: pilotInfo.lastName,
                email: pilotInfo.email,
                phoneNumber: pilotInfo.phoneNumber
            });
            // update toBeRemovedPilots
            toBeRemovedPilots.set(droneSerialNumber, {
                firstName: pilotInfo.firstName, 
                lastName: pilotInfo.lastName,
                email: pilotInfo.email,
                phoneNumber: pilotInfo.phoneNumber,
                timeOfLastViolation: toBeRemovedPilots.get(droneSerialNumber).timeOfLastViolation
            });
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

// return true if 10 minutes has passed since timeOfLastViolation
function isTimeOut(timeOfLastViolation)
{
    // time currently minus time of the violation is larger than time out
    return (new Date().getTime() - new Date(timeOfLastViolation).getTime() > PILOT_TIME_OUT);
}

function removeOldPilots() 
{
    // compere last violation to pilot time out time
    toBeRemovedPilots.forEach( (pilotInfo, droneSerialNumber) => {
        if (isTimeOut(pilotInfo.timeOfLastViolation))
        {
            // remove from toBeRemovedPilots list
            toBeRemovedPilots.delete(droneSerialNumber);
            console.log("database read for delete command, drone:", droneSerialNumber);
            console.log(new Date());
            // add pilot to list to be removed from client
            oldPilotsClient.add({
                firstName: pilotInfo.firstName, 
                lastName: pilotInfo.lastName,
                email: pilotInfo.email,
                phoneNumber: pilotInfo.phoneNumber
            });
        }
    });
}

// initial web request
app.get('/', (request,response) =>{
    const allPilots = getPilotList();
    response.render('index',{allPilots});
    console.log("Add pilots >>>>>>", allPilots)
});

// update pilot list request
app.get('/api', (request, response) => {
    response.json({
        addPilots: Array.from(newPilotsClient),
        removePilots: Array.from(oldPilotsClient)
    });
    console.log("pilots to be added (" + promisedPilots.size
    + ") pilots added", newPilotsClient);
    console.log("pilots to be removed (" + toBeRemovedPilots.size 
        + ") pilots removed", oldPilotsClient);
        
    // clear update lists
    newPilotsClient.clear();
    oldPilotsClient.clear();
});

// fetch data every 2 seconds
setInterval( function () 
{
    console.log("loop run");

    // activate fetch promis for pilots
    promisedPilots.forEach((timeOfLastViolation, droneSerialNumber) => fetchPilot(droneSerialNumber));

    // fetch drone positions and pilot info from the web,
    // update newPilotsClient list
    fetchDrones();

    // remove 10 min old pilots from toBeRemovedPilots and add them to oldPilotsClient list
    removeOldPilots();
},UPDATE_TIME);




exports.app = functions.https.onRequest(app);

