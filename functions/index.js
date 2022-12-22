
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
async function fetchDronePositions(URL_DRONE_POSITIONS)
{
    const response = await fetch(URL_DRONE_POSITIONS, {
    method: 'GET'
        });
    if ( !response.ok ) { 
        console.log("ERROR: Fetch error >>> ", response.statusText);
        return;
    }
    // parsing xml data to json

    const xmlFile = await response.text();

    var result;

    parseString(xmlFile, function (parserError, jsonfile) {
        result = jsonfile;

        

    });

 
    const droneList = result.report.capture[0].drone;

    droneList.forEach((newPilot) => {
        console.log("print out ====", newPilot.serialNumber);
    
    }); 

   
}


// test data                                                     TODO
const newPilots = ["Ram", "Shyam", "Sita", "Gita"];
const oldPilots = ["Ram", "Shyam"];
const allPilotsTes = {
    firstName: "huh",
    lastName: "dsdsds",
    email: "Sita",
    phoneNumber: "Gita"
};

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
   
}, 2000);



// start server
exports.app = functions.https.onRequest(app);