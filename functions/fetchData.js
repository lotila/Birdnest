const parser = require("./dataParsers")

const url_dronePositions = "https://assignments.reaktor.com/birdnest/drones";

module.exports = {
    dronePostions: async function () {
        const response = await fetch(url_dronePositions, {
            method: 'GET'
          });
        var data = await response.text();
        data = parser.droneInfo();
        console.log(data);
    }
};