const parser = require("./dataParsers")


module.exports = {
    drones: async function () {
        const url_drones = "https://assignments.reaktor.com/birdnest/drones";

        return fetch(url_drones);
    }
};