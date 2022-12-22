
const fetchData = require("./fetchData")
const { parseString } = require("xml2js");
const URL_DRONE_POSITIONS = "https://assignments.reaktor.com/birdnest/drones";


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

// fetch drone positions from the web and update database
// return pilots to be added to client's pilot list
async function fetchDronePositions(URL_DRONE_POSITIONS)
{
    // return list
    var newPilots = [];

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

    // get time 
    const snapshotTimestamp = jsonFile.report.capture[0]['$'].snapshotTimestamp;

    // update database
    var droneSerialNumber;
    droneList.forEach((newDrone) => {
        // check if drone is in no-fly zone

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
    const jsonfile = fetchDronePositions(URL_DRONE_POSITIONS);   
   
}, 10000);



// start server
exports.app = functions.https.onRequest(app);