const URL_DRONE_POSITIONS = "https://assignments.reaktor.com/birdnest/drones";
const URL_PILOT_INFO = "https://assignments.reaktor.com/birdnest/pilots/";

// data update rate (in milliseconds)
const UPDATE_RATE = 2000;

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

// xml to json 
const { parseString } = require("xml2js");

// server-client connection
const express = require('express');

// firebase as web hosting provider and dataBase
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

// dataBase
// name, email, phonenumber, drone serial number are saved here
const dataBase = admin.firestore().collection('pilot_data');

// Pilots that are to be added and removed in the next request.
const newPilotsClient = [];
const oldPilotsClient = [];

// list of promises to fetch pilots.
// to be added in database and newPilotsClient list
    // key = drone serial number
    // data = timeOfLastViolation:
var promisedPilots = new Map();

// pilots to be removed from database and client's list after 10 minutes
// key = drone serial number
// data = timeOfLastViolation
var toBeRemovedPilots = new Map();

// get pilot list from the dataBase for client
async function getPilotList(){
    const snapshotOfDatabase = await dataBase.get();
    var pilotList = [];
    var pilotInfo;
    snapshotOfDatabase.forEach(async (pilot) => 
    {
        pilotInfo = pilot.data();
        // if pilot is in toBeRemovedPilots
        if (toBeRemovedPilots.has(pilot.id)) {
            // pilot to be added to client's pilot list
            pilotList.push({
                firstName: pilotInfo.firstName, 
                lastName: pilotInfo.lastName,
                email: pilotInfo.email,
                phoneNumber: pilotInfo.phoneNumber
            });
        }
        else {
            pilot.ref.delete().catch((dbDeleteFileError) => {
                console.log(ERROR.DB_DELETE_PILOT, dbDeleteFileError);
            });
        }
    });
    return pilotList;
}

// check for fly zone violation
function isFlyZoneViolation(dronePosX, dronePosY, NESTZONE) {
    return NESTZONE.RADIOUS >= Math.sqrt(
        Math.pow(dronePosX - NESTZONE.POSX, 2) + 
        Math.pow(dronePosY - NESTZONE.POSY, 2))
}

// fetch drone positions and pilots to promisedPilots list
async function fetchDrones()
{
    // fetch drone postions data
    const dronesResponse = await fetch(URL_DRONE_POSITIONS, {
        method: 'GET'
        });
    if ( !dronesResponse.ok ) { 
        console.log(ERROR.FETCH_DRONES, dronesResponse.statusText);
        return;
    }
    // get xml
    const xmlFile = await dronesResponse.text();

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
    droneList.forEach( (newDrone) => {
        droneSerialNumber = newDrone.serialNumber[0];
        // if not violation, move to next drone
        if (!isFlyZoneViolation(newDrone.positionX[0], newDrone.positionY[0], NESTZONE)) 
        { return }

        // check if pilot is already in promisedPilots list
        if (promisedPilots.has(droneSerialNumber)){
            // update time
            promisedPilots.set(droneSerialNumber, timeOfLastViolation);
        }
        // check if pilot is already in toBeRemovedPilots
        else if(toBeRemovedPilots.has(droneSerialNumber)) {
            // update time
            toBeRemovedPilots.set(droneSerialNumber, timeOfLastViolation)
        }
        else {
            promisedPilots.set(droneSerialNumber, timeOfLastViolation); 
            // activate fetch promis for pilot
            fetchPilot(droneSerialNumber);
        }
    }); 
    }

// when promise settles, add pilot to newPilotsClient list and remove from promisedPilots
function fetchPilot(droneSerialNumber) 
{
    // drone doesn't exists, fetch new pilot
    fetch(URL_PILOT_INFO + droneSerialNumber, {
        method: 'GET'
    }).then((pilotResponse) => 
    {
        // get json
        pilotResponse.json().then( (pilotInfo) => 
        {
            // add pilot to client's list
            newPilotsClient.push({
                firstName: pilotInfo.firstName, 
                lastName: pilotInfo.lastName,
                email: pilotInfo.email,
                phoneNumber: pilotInfo.phoneNumber
            });
            console.log("database read for add command, drone:", droneSerialNumber);
            console.log("list has drone already",promisedPilots.has(droneSerialNumber));
            // add pilot to dataBase
            dataBase.doc(droneSerialNumber).set( {
                firstName: pilotInfo.firstName,
                lastName: pilotInfo.lastName,
                phoneNumber: pilotInfo.phoneNumber,
                email: pilotInfo.email
            }).then(() => 
            {
                // add to toBeRemovedPilots list
                toBeRemovedPilots.set(droneSerialNumber, promisedPilots.get(droneSerialNumber));
                // remove from promised pilots list
                promisedPilots.delete(droneSerialNumber);
            }).catch((error) => 
            {
                console.log(ERROR.DB_ACCESS, error);
            });
        });
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
    toBeRemovedPilots.forEach( async (timeOfLastViolation, droneSerialNumber) => {
        if (isTimeOut(timeOfLastViolation))
        {
            console.log("database read for delete command, drone:", droneSerialNumber);

            // get pilot from database
            const databaseResponse = await dataBase.doc(droneSerialNumber).get();

            if (!databaseResponse.ok) {
                console.log(ERROR.DB_ACCESS, databaseResponse.statusText);
            }

            // remove from toBeRemovedPilots list
            toBeRemovedPilots.delete(droneSerialNumber);
            
            const pilotInfo = databaseResponse.data();

            // add pilot to list to be removed from client
            oldPilotsClient.push({
                firstName: pilotInfo.firstName, 
                lastName: pilotInfo.lastName,
                email: pilotInfo.email,
                phoneNumber: pilotInfo.phoneNumber
            });
            // delete pilot from database
            databaseResponse.ref.delete().catch((dbDeleteFileError) => 
            {
                console.log(ERROR.DB_DELETE_PILOT, dbDeleteFileError);
            });
        }
    });
}

// initial web request
app.get('/',async (request,response) =>{
    const allPilots = await getPilotList();
    response.render('index',{allPilots});
    console.log("Add pilots >>>>>>", allPilots)
});

// update pilot list request
app.get('/api', (request, response) => {
    response.json({
    addPilots: newPilotsClient,
    removePilots: oldPilotsClient
    });
    console.log("pilots to be added (" + promisedPilots.size 
        + ") pilots added", newPilotsClient);
    console.log("pilots to be removed (" + toBeRemovedPilots.size 
        + ") pilots removed", oldPilotsClient);
        
    // clear arrays
    newPilotsClient.length = 0;
    oldPilotsClient.length = 0;
});

// fetch data every 2 seconds
setInterval( function () 
{
    // fetch drone positions and pilot info from the web,
    // update dataBase and newPilotsClient list
    fetchDrones();

    // remove 10 min old pilots from database and add them to oldPilotsClient list
    removeOldPilots();
},UPDATE_RATE);


exports.app = functions.https.onRequest(app);

