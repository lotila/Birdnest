
const fetchData = require("./fetchData")
const { parseString } = require("xml2js");
const URL_DRONE_POSITIONS = "https://assignments.reaktor.com/birdnest/drones";

const NESTZONE = {
    POSX: 250000,
    POSY: 250000,
    RADIOUS: 100
};

const express = require('express');

// firebase as web hosting provider and database
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
credential: admin.credential.cert(serviceAccount),
});

// available on the web
//admin.initializeApp(functions.config().firebase);

// database
const database = admin.firestore().collection('pilot_data');

// limit trasfer size
app.use(express.json({ limit: '1mb' }));

// get pilot list from the database for client
async function getPilotList(){
    const snapshot = await database.get();
    var pilotList = [];
    snapshot.forEach(doc => {
        pilotList.push(doc.data().firstName 
        + " " + doc.data().lastName
        + " " + doc.data().email
        + " " + doc.data().phoneNumber
        );});
    return pilotList;
}

// check for fly zone violation
function isFlyZoneViolation(dronePosX, dronePosY, NESTZONE) {
    return NESTZONE.RADIOUS < Math.sqrt(
        Math.pow(dronePosX - NESTZONE.POSX, 2) + 
        Math.pow(dronePosY - NESTZONE.POSY, 2))
}

// fetch drone positions from the web and update database
// return pilots to be added to client's pilot list
async function fetchDronePositions(URL_DRONE_POSITIONS, NESTZONE)
{
    // fetch drone postions data
    const response = await fetch(URL_DRONE_POSITIONS, {
    method: 'GET'
        });
    if ( !response.ok ) { 
        console.log("ERROR: Fetch error", response.statusText);
        return;
    }

    const xmlFile = await response.text();
    var jsonFile;
    // parsing xml data to json
    parseString(xmlFile, function (parserError, result) {
        jsonFile = result;
    });
    const droneList = jsonFile.report.capture[0].drone;

    // return pilot list
    const newPilots = [];

    // get time 
    const snapshotTimestamp = jsonFile.report.capture[0]['$'].snapshotTimestamp;

    var droneSerialNumber;
    droneList.forEach((newDrone) => {
        // if not violation, move to next drone
        if (!isFlyZoneViolation(newDrone.positionX[0], newDrone.positionY[0], NESTZONE)) 
        { return }
        console.log(newDrone.positionX[0]);
        console.log(newDrone.positionY[0]);

        // check if pilot already exits in database
        droneSerialNumber = newDrone.serialNumber[0];
        database.doc(droneSerialNumber).get().then((doc) => {
            if (doc.exists) {
                // drone exists in dabase, change time Of Last Violation           
                doc.snapshotTimestamp =  snapshotTimestamp;
            } else {
                // drone doesn't exists, add drone
                database.doc(droneSerialNumber).set({
                    firstName: "jsdkjks",
                    timeOfLastViolation: snapshotTimestamp
                }).catch((error) => {
                    console.log("ERROR Database add error", error);
                }); 
            }
        }).catch((error) => {
            console.log("ERROR Database access error", error);
        });   
    }); 

    return newPilots;
}


// Pilots that are to be added and removed in next post request.
const newPilots = ["Ram", "Shyam", "Sita", "Gita"];
const oldPilots = ["Ram", "Shyam"];

// initial web request
app.get('/',async (request,response) =>{
    const allPilots = await getPilotList();
    response.render('index',{allPilots});
});

// update pilot list data
app.post('/api', (request, response) => {
    response.json({
    addPilots: newPilots,
    removePilots: oldPilots
    });
});


// fetch data every 2 seconds
setInterval( function () {
    const jsonfile = fetchDronePositions(URL_DRONE_POSITIONS, NESTZONE);   
   
}, 10000);



exports.app = functions.https.onRequest(app);