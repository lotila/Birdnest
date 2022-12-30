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
    FETCH_PILOT: "ERROR: Fetch pilot info error",
    FETCH_DRONES: "ERROR: Fetch drone positions error",
};

// remove pilots after 10 minutes (in milliseconds)
const PILOT_TIME_OUT = 4*60*1000;

// remove time stamps after 10 minutes (in milliseconds)
// client doesn't have to be reload page if connection is lost for short period.
const TIME_STAMP_TIME_OUT = 10*60*1000;

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

// activePilots stores pilot info
// key = drone serial number
// data = {
//    firstName:
//    lastName: 
//    email: 
//    phoneNumber:
//    closestDistanceToNest:
//    timeOfLastViolation:
//}
const activePilots = new Map();

// flyZoneViolations stores timeOfLastViolation for activePilots
// key = drone serial number
// data = timeOfLastViolation
const flyZoneViolations = new Map();

// promisedPilots strores drone serial numbers while loading is in progress
const promisedPilots = new Set();

// timeStampedPilots stores add updates for client
// key = drone serial number
// data = time stamp
const timeStampedPilots = new Map();

// timeStampedOldPilots stores remove updates for client
// key =  drone serial number
// data = time stamp
const timeStampedOldPilots = new Map();

// time is updates, when activePilots chenges
var currentTimeStamp = 0;

var latestTimeStamp = 0;


// check for fly zone violation
function getDistanceToNest(dronePosX, dronePosY) 
{
    return Math.sqrt(
        Math.pow(dronePosX - NESTZONE.POSX, 2) + 
        Math.pow(dronePosY - NESTZONE.POSY, 2))
}

// return true if timeOut has passed since time
function isTimeOut(time, timeOut)
{
    // time currently minus time is larger than time out
    return (new Date().getTime() - time > timeOut);
}

// fetch drone positions and pilots to activePilots list
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
            // parsing xml to json
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
                const distanceToNest = getDistanceToNest(newDrone.positionX[0], newDrone.positionY[0]);
                // if dorne is not inside nest zone, don't fetch pilot info
                if (NESTZONE.RADIOUS < distanceToNest)  { return; }
                console.log("fetch drone:", droneSerialNumber);

                // check if pilot is not already in activePilots
                if(activePilots.has(droneSerialNumber)) {
                    // update time
                    flyZoneViolations.set(droneSerialNumber, timeOfLastViolation);

                    // update activePilots
                    const oldActivePilots = activePilots.get(droneSerialNumber);
                    activePilots.set(droneSerialNumber, {
                        firstName: oldActivePilots.firstName, 
                        lastName: oldActivePilots.lastName,
                        email: oldActivePilots.email,
                        phoneNumber: oldActivePilots.phoneNumber,
                        closestDistanceToNest: distanceToNest,
                        timeOfLastViolation: timeOfLastViolation
                    });

                }
                else {
                    // add to promisedPilots
                    promisedPilots.add(droneSerialNumber);
                    
                    // add/update timeOfLastViolation
                    flyZoneViolations.set(droneSerialNumber, timeOfLastViolation);

                    activePilots.set(droneSerialNumber, {
                        firstName: "qqqq", 
                        lastName: "qqqq",
                        email: "qqqq",
                        phoneNumber: "qqqq",
                        closestDistanceToNest: distanceToNest,
                        timeOfLastViolation: timeOfLastViolation
                    });

                }
            });
        });
    }).catch((error) => {
        console.log(ERROR.FETCH_DRONES, error);
    });
 }

// when promise settles, add pilot to  list 
function fetchPilot(droneSerialNumber) 
{
    promisedPilots.delete(droneSerialNumber);
    //fetch new pilot info
    fetch(URL_PILOT_INFO + droneSerialNumber, {
        method: 'GET'
    }).then((pilotResponse) => 
    {
        // get json
        pilotResponse.json().then((pilotInfo) => 
        {
            // add to timeStamped list
            const newTimeStamp =  new Date().getTime();
            timeStampedPilots.set(droneSerialNumber, newTimeStamp);

            // update time stamp
            if ( currentTimeStamp < newTimeStamp ) {currentTimeStamp = newTimeStamp; }

            // update activePilots
            const oldActivePilots = activePilots.get(droneSerialNumber);
            activePilots.set(droneSerialNumber, {
                firstName: pilotInfo.firstName, 
                lastName: pilotInfo.lastName,
                email: pilotInfo.email,
                phoneNumber: pilotInfo.phoneNumber,
                closestDistanceToNest: oldActivePilots.closestDistanceToNest,
                timeOfLastViolation: oldActivePilots.timeOfLastViolation
            });

            console.log("fetched drone:", droneSerialNumber);
        });
    }).catch((error) => {
        console.log(ERROR.FETCH_PILOT, error);
        // if less than 10 min old request
        if (!isTimeOut(new Date(timeOfLastViolation).getTime(), PILOT_TIME_OUT)) {
            // pilot will be handled again in next interval
            promisedPilots.add(droneSerialNumber);
            timeStampedPilots.delete(droneSerialNumber);
        }
        else { // forget pilot
            activePilots.delete(droneSerialNumber);
            flyZoneViolations.delete(droneSerialNumber);
            timeStampedPilots.delete(droneSerialNumber);
        }
    });
}
function removeOldPilots() 
{
    // remove old timeStamps
    timeStampedOldPilots.forEach((timeStamp, droneSerialNumber) => 
    {
        if (isTimeOut(new Date(activePilots.get(droneSerialNumber).timeOfLastViolation).getTime(), 
            TIME_STAMP_TIME_OUT + PILOT_TIME_OUT))
        {
            // remove time stamp
            timeStampedOldPilots.delete(droneSerialNumber);

            // remove from activePilots
            activePilots.delete(droneSerialNumber);

            console.log("delete drone:", droneSerialNumber);
        }
    })

    // compere last violation to PILOT_TIME_OUT
    flyZoneViolations.forEach( (timeOfLastViolation, droneSerialNumber) => 
    {
        if (isTimeOut(new Date(timeOfLastViolation).getTime(), PILOT_TIME_OUT))
        {
            // update timeStampedPilots 
            timeStampedPilots.forEach((timeStamp, timeStampedDroneSerialNumber) => {
                if (timeStampedDroneSerialNumber === droneSerialNumber){
                    timeStampedPilots.delete(timeStampedDroneSerialNumber);
                }
            });
            // add to timeStampedOldPilots 
            const newTimeStamp =  new Date().getTime();
            timeStampedOldPilots.set(droneSerialNumber, newTimeStamp);
            
            // update current time stamp
            if ( currentTimeStamp < newTimeStamp ) {currentTimeStamp = newTimeStamp; }

            // remove from flyZoneViolations
            flyZoneViolations.delete(droneSerialNumber);
        }
    });
}

// initial web request
app.get('/', (request,response) =>
{
    // get all pilots for client
    const pilotsToBeAdded = [];
    timeStampedPilots.forEach((timeStamp, droneSerialNumber) => {
        if ( latestTimeStamp < timeStamp ) {latestTimeStamp = timeStamp; }
        pilotsToBeAdded.push(activePilots.get(droneSerialNumber));
    });
    const tranferData = {
        pilots: pilotsToBeAdded,
        timeStamp: latestTimeStamp
    }
    // send data
    response.render('index',{tranferData});

    console.log("Add pilots >>>>>>", tranferData.pilots)
});

// get time stamp from client, update client's pilot list and send new time stamp
app.post('/api', (request, response) => 
{
    const pilotsToBeAdded = [];
    const pilotsToBeRemoved = [];
    const clientTimeStamp = request.body;
    const TimeStampTimeOut = isTimeOut(clientTimeStamp, TIME_STAMP_TIME_OUT)

    if (TimeStampTimeOut)
    {
        // get all pilots for client
        timeStampedPilots.forEach((timeStamp, droneSerialNumber) => {
            if ( latestTimeStamp < timeStamp ) {latestTimeStamp = timeStamp; }
            pilotsToBeAdded.push(activePilots.get(droneSerialNumber));
        });
    }
    else 
    {
        // get pilots client is missing
        timeStampedPilots.forEach((timeStamp, droneSerialNumber) => {
            if (clientTimeStamp < timeStamp) 
            {
                pilotsToBeAdded.push(activePilots.get(droneSerialNumber));

                if ( latestTimeStamp < timeStamp ) {latestTimeStamp = timeStamp; }
            }
        });
        // get pilots that should be deleted from client
        timeStampedOldPilots.forEach((timeStamp, droneSerialNumber) => {
            if (clientTimeStamp < timeStamp) 
            {
                pilotsToBeRemoved.push(activePilots.get(droneSerialNumber).email);

                if ( latestTimeStamp < timeStamp ) {latestTimeStamp = timeStamp; }
            }
        });
    }
    
    // send data
    response.json({
        addPilots: pilotsToBeAdded,
        removePilots: pilotsToBeRemoved,
        timeStamp: latestTimeStamp,
        TimeStampTimeOut: TimeStampTimeOut
    });
    console.log("Pilots to be removed (" + timeStampedPilots.size + 
        ")(" + flyZoneViolations.size +")[" + timeStampedOldPilots.size + 
        "]{"+  activePilots.size+ "} removed", pilotsToBeRemoved);
    console.log("Pilots to be added ("  + promisedPilots.size+ 
        ") added", pilotsToBeAdded);
});

// fetch data every 2 seconds
setInterval( function () 
{
    // activate fetch promises for pilots
    promisedPilots.forEach((droneSerialNumber) => fetchPilot(droneSerialNumber));

    // fetch drone positions and drone serial numbers
    // if violated NDC add them to promisedPilots
    fetchDrones();

    // remove 10 min old pilots from timeStampedPilots and add them to timeStampedOldPilots list
    removeOldPilots();

    console.log("loop run");
},UPDATE_TIME);




exports.app = functions.https.onRequest(app);

