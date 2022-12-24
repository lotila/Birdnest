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
const PILOT_TIME_OUT = 60*1000;

// xml to json 
const { parseString } = require("xml2js");

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

// available on the localhost:5000
var serviceAccount = require("../../dronetracking.json");
const { response } = require("express");
admin.initializeApp({
credential: admin.credential.cert(serviceAccount)
});

// available on the web
//admin.initializeApp(functions.config().firebase);


// dataBase
const dataBase = admin.firestore().collection('pilot_data');

// Pilots that are to be added and removed in the next request.
var newPilotsClient = [];
var oldPilotsClient = [];

// list of promises to fetch pilots.
// to be added in database and newPilotsClient list
    // key = drone serial number
    // data = {
    // promis:
    // timeOfLastViolation:
    // }
var promisedPilots = new Map();

// pilots to be removed in database and client's list
// key = drone serial number
// data = timeOfLastViolation
var toBeRemovedPilots = new Map();

// data format for client
function viewFormat(firstName, lastName, email, phoneNumber) {
     return firstName + " " + lastName
        + " " + email + " " + phoneNumber;
}

// get pilot list from the dataBase for client
async function getPilotList(){
    const snapshotOfDatabase = await dataBase.get();
    var pilotList = [];
    var pilotInfo;
    snapshotOfDatabase.forEach(async (pilot) => {
        pilotInfo = pilot.data();
        // if pilot is older than PILOT_TIME_OUT
        if (new Date(pilotInfo.timeOfLastViolation).getTime()  <
            new Date().getTime() - PILOT_TIME_OUT) {
            
            // remove pilot from database
            await pilot.ref.delete();
        }
        else {
            // pilot to be added to client's pilot list
            pilotList.push(viewFormat(pilotInfo.firstName, pilotInfo.lastName,
                pilotInfo.email, pilotInfo.phoneNumber));
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

// fetch drone positions and pilot info from the web,
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

        const mapData =  {
            promis: dataBase.doc(droneSerialNumber).get(), 
            timeOfLastViolation: timeOfLastViolation
        };
        // check if there is fetch promis for pilot already
        if (promisedPilots.has(droneSerialNumber)){
            promisedPilots.set(droneSerialNumber, {
                // promis found, update time for that promis
                promis: promisedPilots.get(droneSerialNumber).promis, 
                timeOfLastViolation: timeOfLastViolation 
            });
        }
        else{
            promisedPilots.set(droneSerialNumber, mapData); 
            // activate fetch promis for pilot
            fetchPilot(mapData.promis, droneSerialNumber, mapData.timeOfLastViolation);
        }
    }); 
    }

// when promise settles, add pilot to database and newPilotsClient list
function fetchPilot(pilotRequestFromDatabase, 
    droneSerialNumber, timeOfLastViolation) 
{
    // add/update pilot in list of pilots to be removed after PILOT_TIME_OUT
    toBeRemovedPilots.set(droneSerialNumber, timeOfLastViolation);

    pilotRequestFromDatabase.then( async(pilotInDatabase) => {
    // check if drone already exists in dataBase
    if (pilotInDatabase.exists) {
        // drone exists in dataBase, change time Of Last Violation           
        pilotInDatabase.timeOfLastViolation =  timeOfLastViolation;
    } 
    else {
        // drone doesn't exists, fetch new pilot
        fetch(URL_PILOT_INFO + droneSerialNumber, {
            method: 'GET'
        }).then((pilotResponse) => 
        {
            // get json
            pilotResponse.json().then( (pilotInfo) => {

            // add pilot to dataBase
            dataBase.doc(droneSerialNumber).set( {
                firstName: pilotInfo.firstName,
                lastName: pilotInfo.lastName,
                phoneNumber: pilotInfo.phoneNumber,
                email: pilotInfo.email,
                timeOfLastViolation: timeOfLastViolation
            }).then(() => {
                // add pilot to client's list
                newPilotsClient.push(viewFormat(pilotInfo.firstName, 
                pilotInfo.lastName, pilotInfo.email, pilotInfo.phoneNumber));
            })
        })
        })
    }
    });
}

async function removeOldPilots() 
{
    // older pilots than this will be removed
    const pilotTimeOutTime =  new Date().getTime() - PILOT_TIME_OUT;;

    // compere last violation to pilot time out time
    var pilotInfo;
    var databaseResponse;
    var droneSerialNumber;
    toBeRemovedPilots.forEach( async (timeOfLastViolation, droneSerialNumber) => {
        if (new Date(timeOfLastViolation).getTime()  < pilotTimeOutTime )
        {
            // get pilot from database
            databaseResponse = await dataBase.doc(droneSerialNumber).get();
            if ( !databaseResponse.ok ) { 
                console.log(ERROR.DB_ACCESS, databaseResponse.statusText);
                return;
            }
            pilotInfo = databaseResponse.data();
            // delete pilot from database
            databaseResponse = await databaseResponse.ref.delete();
            if ( !databaseResponse.ok ) { 
                console.log(ERROR.DB_DELETE_PILOT, databaseResponse.statusText);
                return;
            }
            // add pilot to list to be removed from client
            oldPilotsClient.push(viewFormat(pilotInfo.firstName, pilotInfo.lastName, 
                pilotInfo.email, pilotInfo.phoneNumber));
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
app.post('/api', (request, response) => {
    response.json({
    addPilots: newPilotsClient,
    removePilots: oldPilotsClient
    });
    console.log("New pilots to be added >>>>>>>", newPilotsClient);
    console.log("New pilots to be removed >>>>>>>", oldPilotsClient);
    // clear arrays
    newPilotsClient.length = [];
    oldPilotsClient.length = [];
});

// fetch data every 2 seconds
setInterval( async function () 
{
    // fetch drone positions and pilot info from the web,
    // update dataBase and newPilotsClient list
    await fetchDrones();

    // remove 10 min old pilots from database and add them to oldPilotsClient list
    await removeOldPilots();
},2000);


exports.app = functions.https.onRequest(app);

