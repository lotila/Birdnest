
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
const { response } = require("express");
admin.initializeApp({
credential: admin.credential.cert(serviceAccount),
});

// available on the web
//admin.initializeApp(functions.config().firebase);

var droneData = "fetchData.drones();";

var dronePilot = [
        "drone pilot 2"
    ];


// limit trasfer size
app.use(express.json({ limit: '1mb' }));

// initial web request
app.get('/',async (request,response) =>{
    response.render('index',{dronePilot});
});

// update pilot list data
app.post('/api', (request, response) => {
    response.json({
        status: 'success'
    });
});


// start server
exports.app = functions.https.onRequest(app);