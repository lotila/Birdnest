const URL_DRONE_POSITIONS = "https://assignments.reaktor.com/birdnest/drones";
const URL_PILOT_INFO = "https://assignments.reaktor.com/birdnest/pilots/";

const NESTZONE = {
    POSX: 250000,
    POSY: 250000,
    RADIOUS: 100000
};

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

// available on the local host 
var serviceAccount = require("../../dronetracking.json");
const { response } = require("express");
admin.initializeApp({
credential: admin.credential.cert(serviceAccount)
});

// available on the web
//admin.initializeApp(functions.config().firebase);

// dataBase
const dataBase = admin.firestore().collection('pilot_data');

// limit trasfer size
app.use(express.json({ limit: '1mb' }));

// data format for client
function viewFormat(firstName, lastName, email, phoneNumber) {
     return firstName + " " + lastName
        + " " + email + " " + phoneNumber;
}

// get pilot list from the dataBase for client
async function getPilotList(){
    const snapshot = await dataBase.get();
    var pilotList = [];
    snapshot.forEach(doc => {
        pilotList.push(viewFormat(doc.data().firstName, doc.data().lastName,
        doc.data().email, doc.data().phoneNumber));
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
// update dataBase and newPilotsClient list
async function fetchPilots(newPilotsClient)
{
    // fetch drone postions data
    const response = await fetch(URL_DRONE_POSITIONS, {
    method: 'GET'
        });
    if ( !response.ok ) { 
        console.log("ERROR: Fetch drone positions error", response.statusText);
        return;
    }
    // get xml
    const xmlFile = await response.text();

    var jsonFile;
    // parsing xml data to json
    parseString(xmlFile, function (parserError, result) {
        jsonFile = result;
    });
    const droneList = jsonFile.report.capture[0].drone;

    // get time 
    const snapshotTimestamp = jsonFile.report.capture[0]['$'].snapshotTimestamp;

    var droneSerialNumber;
    droneList.forEach( (newDrone) => {
        // if not violation, move to next drone
        if (!isFlyZoneViolation(newDrone.positionX[0], newDrone.positionY[0], NESTZONE)) 
        { return }

        // check if drone already exits in dataBase
        droneSerialNumber = newDrone.serialNumber[0];
        dataBase.doc(droneSerialNumber).get().then((pilotInDatabase) => {
            if (pilotInDatabase.exists || pilotInDatabase.empty) {
                // drone exists in dataBase, change time Of Last Violation           
                pilotInDatabase.snapshotTimestamp =  snapshotTimestamp;
            } 
            else {
                // drone doesn't exists, fetch new pilot
                fetch(URL_PILOT_INFO + droneSerialNumber, {
                    method: 'GET'
                    }).then( async (response) => {
                        // get json
                        const pilotInfo = await response.json();
                        
                        // add pilot to client's list
                        newPilotsClient.push(viewFormat(pilotInfo.firstName, 
                            pilotInfo.lastName, pilotInfo.email, pilotInfo.phoneNumber));

                        // add pilot to dataBase
                        dataBase.doc(droneSerialNumber).set( {
                            firstName: pilotInfo.firstName,
                            lastName: pilotInfo.lastName,
                            phoneNumber: pilotInfo.phoneNumber,
                            email: pilotInfo.email,
                            timeOfLastViolation: snapshotTimestamp
                        });
                    }).catch((error) => {
                        console.log("ERROR: Fetch pilot info error", error);
                        return;
                });
            }
        }).catch((error) => {
            console.log("ERROR: dataBase access error", error);
        });   
    }); 
}

function removeOldPilots(oldPilotsClient) {

}

// Pilots that are to be added and removed in the next request.
var newPilotsClient = [];
var oldPilotsClient = [];

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
setInterval( function () {
    // fetch drone positions and pilot info from the web,
    // update dataBase and newPilotsClient list
    fetchPilots(newPilotsClient); 

    // remove 10 min old pilots from database and add them to oldPilotsClient list
    removeOldPilots(oldPilotsClient);
},5000);


exports.app = functions.https.onRequest(app);

