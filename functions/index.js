
const fetchData = require("./fetchData")

const functions = require('firebase-functions');
const express = require('express');
const engines = require('consolidate');
var hbs = require('handlebars');
const admin = require('firebase-admin');

// front end is in views folder
const app = express();
app.engine('hbs',engines.handlebars);
app.set('views','./views');
app.set('view engine','hbs');

// available on the local host 
var serviceAccount = require("../../dronetracking.json");
admin.initializeApp({
credential: admin.credential.cert(serviceAccount),
});

// available on the web
//admin.initializeApp(functions.config().firebase);

var droneData = "fetchData.drones();";


app.get('/',async (request,response) =>{
    response.render('index',{dronePilot:[
        "drone pilot 1", 
        "drone pilot 2"
    ]});
});


exports.app = functions.https.onRequest(app);