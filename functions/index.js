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

// fetch pilot info
async function fetchPilotInfo(
    droneSerialNumber, snapshotTimestamp, URL_PILOT_INFO) {
    // fetch
    const response = await fetch(URL_PILOT_INFO + droneSerialNumber, {
        method: 'GET'
            });
    if ( !response.ok ) { 
        console.log("ERROR: Fetch pilot info error", response.statusText);
        return result;
    }
    const pilotInfo = await response.json();
    // add pilot to dataBase
    dataBase.doc(droneSerialNumber).set({
        firstName: pilotInfo.firstName,
        lastName: pilotInfo.lastName,
        phoneNumber: pilotInfo.phoneNumber,
        email: pilotInfo.email,
        timeOfLastViolation: snapshotTimestamp
    }).catch((error) => {
        console.log("ERROR dataBase add error", error);
    }); 
}

// fetch drone positions and pilot info from the web
// update dataBase
async function updatedataBase(
    URL_DRONE_POSITIONS, URL_PILOT_INFO,  NESTZONE)
{
    // fetch drone postions data
    const response = await fetch(URL_DRONE_POSITIONS, {
    method: 'GET'
        });
    if ( !response.ok ) { 
        console.log("ERROR: Fetch drone positions error", response.statusText);
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

    var droneSerialNumber;
    droneList.forEach((newDrone) => {
        // if not violation, move to next drone
        if (!isFlyZoneViolation(newDrone.positionX[0], newDrone.positionY[0], NESTZONE)) 
        { return }

        // check if drone already exits in dataBase
        droneSerialNumber = newDrone.serialNumber[0];
        dataBase.doc(droneSerialNumber).get().then((doc) => {
            if (doc.exists) {
                // drone exists in dataBase, change time Of Last Violation           
                doc.snapshotTimestamp =  snapshotTimestamp;
            } else {
                // drone doesn't exists, add new pilot
                fetchPilotInfo(droneSerialNumber, snapshotTimestamp, URL_PILOT_INFO);
            }
        }).catch((error) => {
            console.log("ERROR dataBase access error", error);
        });   
    }); 
}


// Pilots that are to be added and removed in the next request.
var newPilots = [];
var oldPilots = [];

// look for database update and queue pilot list update for client
dataBase.onSnapshot(querySnapshot => {
    querySnapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
          newPilots.push(viewFormat(change.doc.data().firstName,change.doc.data().lastName, 
          change.doc.data().email, change.doc.data().phoneNumber))
      }
      if (change.type === 'removed') {
          oldPilots.push(viewFormat(change.doc.data().firstName,change.doc.data().lastName, 
          change.doc.data().email, change.doc.data().phoneNumber))
      }
    });
  });
  
// initial web request
newPilots.length=0;
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
    // clear arrays
    newPilots.length = 0;
    oldPilots.length = 0;
});

// fetch data every 2 seconds
setInterval( function () {
    updatedataBase(
        URL_DRONE_POSITIONS, URL_PILOT_INFO, NESTZONE); 

}, 10000);


exports.app = functions.https.onRequest(app);

