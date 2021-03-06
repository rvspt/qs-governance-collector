var Promise = require("bluebird");
var qrsCalls = require("./qrsCalls");
var writeToXML = require("./writeToXML");
var logger = require("./logger");
var socketHelper = require("./socketHelper");
var fs = require("fs");
var path = require("path");

var loggerObject = {
    jsFile: "userAccessControl.js"
};

function logMessage(level, msg) {
    if (level == "info" || level == "error") {
        socketHelper.sendMessage("governanceCollector", msg);
    }
    logger.log(level, msg, loggerObject);
}

var start_time, end_time;

var userAccessControl = {
    userAppObjectAccessControl: function (config, userList, objectType) {
        start_time = new Date(Date.now());
        logMessage("info", objectType + " access control collection started at " + start_time);
        return new Promise(function (resolve, reject) {
            logMessage("info", "Obtaining access control information on " + objectType + " from the repository");
            var userCount = userList.length;
            return qrsCalls.qrsAuditCountResources(config, "App.Object", "objecttype eq '" + objectType + "'")
                .then(function (count) {
                    logMessage("info", "Found " + count + " object of type " + objectType);
                    return Promise.map(userList, function (userInfo, index, length) {
                        logMessage("info", "Processing user " + index + " of " + length + " " + objectType + "s.  User is " + userInfo.userDirectory + "\\" + userInfo.userId);
                        var auditObject = createAuditObject("App.Object", count, { "resourceFilter": "objectType eq '" + objectType + "'" }, { "resourceFilter": "id eq " + userInfo.id });
                        return qrsCalls.qrsAuditMatrix(config, auditObject)
                            .then(function (result) {
                                result.matrix.forEach(function (item, index) {
                                    result.matrix[index].name = result.resources[result.matrix[index].resourceId].resourceProperties.name;
                                    result.matrix[index].engineObjectId = result.resources[result.matrix[index].resourceId].resourceProperties.engineobjectid;
                                    result.matrix[index].objectType = result.resources[result.matrix[index].resourceId].resourceProperties.objecttype;
                                    result.matrix[index].userId = result.subjects[result.matrix[index].subjectId].subjectProperties.userid;
                                    result.matrix[index].userDirectory = result.subjects[result.matrix[index].subjectId].subjectProperties.userdirectory;
                                    result.matrix[index].audit.access = convertActionBin(item.audit.access);
                                    result.matrix[index].audit.disabled = convertActionBin(item.audit.disabled);
                                });
                                return result;
                            })
                            .then(function (result) {
                                //fs.writeFileSync(path.join(config.agent.metadataPath,"userAccess",objectType, userInfo.id + "_" + objectType + ".json"), JSON.stringify(result));
                                //console.log(result.matrix.length)
                                //writeToXML("qrsAccessControlMatrix", "AppObject", result.matrix, userInfo.id + "_" + objectType, undefined, "userAccess");
                                return result.matrix;
                            })
                            .catch(function (error) {
                                logMessage("error", error);
                                return error;
                            });
                    }, { concurrency: 5 })
                        .then(function (resultArray) {
                            console.log(resultArray.length);
                            return createOutput(resultArray, config, objectType)
                                .then(function (foobar) {

                                    end_time = new Date(Date.now());
                                    logMessage("info", objectType + " access control collection process complete at " + end_time);
                                    logMessage("info", "It took " + findDateDiff(start_time, end_time) + " to complete this operation");
                                    return;

                                })
                        })
                        .then(function () {
                            resolve("yay!");
                        })
                        .catch(function (error) {
                            logMessage("error", error)
                            resolve("resolved with errors");
                        })
                })
        })
    },
    userAccessControl: function (config, userList) {
        return new Promise(function (resolve, reject) {
            var selectionBasis = list(userList);
            logMessage("info", "Obtaining access control information from the repository");
            return Promise.all(selectionBasis.map(function (listItem) {
                return qrsCalls.qrsPost(config, "selection", listItem)
                    .then(function (selection) {
                        return selection.id;
                    })
                    .catch(function (error) {
                        logMessage("error", error)
                        reject(error);
                    })
            }))
                .then(function (resultArray) {
                    return Promise.map(resultArray, function (selectionItem) {
                        return Promise.all(resources.map(function (resource) {
                            return qrsCalls.qrsAuditCountResources(config, resource.resourceRef, "")
                                .then(function (count) {
                                    logMessage("info", "Found " + count + " resource of type " + resource.resourceRef);
                                    var auditObject = createAuditObject(resource.resourceRef, count * userList.length, {"resourceFilter": ""}, { "selection": selectionItem });
                                    return qrsCalls.qrsAuditMatrix(config, auditObject)
                                        .then(function (result) {
                                            console.log(result.matrix.length);
                                            result.matrix.forEach(function (item, index) {
                                                result.matrix[index].name = result.resources[result.matrix[index].resourceId].resourceProperties.name;
                                                result.matrix[index].userId = result.subjects[result.matrix[index].subjectId].subjectProperties.userid;
                                                result.matrix[index].userDirectory = result.subjects[result.matrix[index].subjectId].subjectProperties.userdirectory;
                                                result.matrix[index].audit.access = convertActionBin(item.audit.access);
                                                result.matrix[index].audit.disabled = convertActionBin(item.audit.disabled);
                                            });
                                            return result;
                                        })
                                        .then(function (result) {
                                            //fs.writeFileSync(path.join(config.agent.metadataPath,"userAccess","testResult_" + selectionItem + ".json"), JSON.stringify(result));
                                            console.log(result.matrix.length)
                                            writeToXML("qrsAccessControlMatrix", resource.resourceRef, result.matrix, selectionItem, undefined, "userAccess");
                                            return result;
                                        })
                                        .catch(function (error) {
                                            logMessage("error", error)
                                            reject(error)
                                        });
                                });
                        }))
                    }, { concurrency: 2 })
                })
                .then(function (resultArray) {
                    console.log("hello world");
                    //writeToXML("qrsAccessControlMatrix", "qrsAccessControlMatrix", resultArray);
                    resolve("Access Control Information Obtained");
                })
                .catch(function (error) {
                    logMessage("error", error)
                    reject(error);
                });
        });
    }
}

module.exports = userAccessControl;

function convertActionBin(val) {
    var strArray = ["Create", "Read", "Update", "Delete", "Export", "Publish",
        "Change owner", "Change role", "Export data"
    ];

    var resultArray = [];
    for (var i = 0; i < strArray.length; i++) {
        if ((val & (1 << i)) == Math.pow(2, i)) {
            resultArray.push(strArray[i])
        }
    }
    return resultArray;
}


var resources = [{
        resourceRef: "App",
        resourcePath: "app"
    },
    {
        resourceRef: "DataConnection",
        resourcePath: "dataconnection"
    },
    {
        resourceRef: "ContentLibrary",
        resourcePath: "contentlibrary"
    },
    {
        resourceRef: "Stream",
        resourcePath: "stream"
    }
];


function createTable(resource) {
    var tableDef = {
        entity: resource,
        columns: [{
                name: "resourceId",
                columnType: "Property",
                definition: "id"
            },
            {
                name: "resourceName",
                columnType: "Property",
                definition: "name"
            },
            {
                name: "objectId",
                columnType: "Property",
                definition: "engineObjectId"
            },
            {
                name: "objectType",
                columnType: "Property",
                definition: "objectType"
            }
        ]
    };
    return tableDef;
}

function findRowMatch(row) {

    if (row[0] === this[0]) {
        return row;
    }
}

function createOutput(resultArray, config, objectType) {
    return new Promise(function (resolve) {
        let maxCount = resultArray.length
        console.log(maxCount);

        fs.writeFileSync(path.join(config.agent.metadataPath, "userAccess", objectType, objectType + ".json"), JSON.stringify(resultArray, null, 4));
        resultArray.forEach(function (result, index) {
            writeToXML("qrsAccessControlMatrix", objectType + "_" + index, result, undefined, undefined, "userAccess/" + objectType);
        })
        resolve("Files Done!");
    })

}

function list(userList) {
    var maxCount = userList.length;
    var i, j = 0;
    var every1kArray = [];
    var mainArray = [];
    for (i = 0; i <= userList.length - 1; i++) {
        j++;
        if (j == 100 || i == userList.length - 1) {
            let object = {
                "type": "user",
                "objectID": userList[i].id
            };
            every1kArray.push(object);
            mainArray.push({ "items": every1kArray });
            every1kArray = [];
            j = 0;
        }
        else {
            let object = {
                "type": "user",
                "objectID": userList[i].id
            };
            every1kArray.push(object);

        }
    }
    return mainArray;
}

function createAuditObject(type, count, resourceRefFilter, subjectRefFilter) {
    var auditObject = {
        "resourceType": type,
        "resourceRefFilter": resourceRefFilter,
        "subjectRefFilter": subjectRefFilter,
        "auditLimit": count
    }
    return auditObject;
}
function findDateDiff(date1, date2) {
    //Get 1 day in milliseconds
    var one_day = 1000 * 60 * 60 * 24;

    // Convert both dates to milliseconds
    var date1_ms = date1.getTime();
    var date2_ms = date2.getTime();

    // Calculate the difference in milliseconds
    var difference_ms = date2_ms - date1_ms;
    //take out milliseconds
    difference_ms = difference_ms / 1000;
    var seconds = Math.floor(difference_ms % 60);
    difference_ms = difference_ms / 60;
    var minutes = Math.floor(difference_ms % 60);
    difference_ms = difference_ms / 60;
    var hours = Math.floor(difference_ms % 24);
    var days = Math.floor(difference_ms / 24);

    return days + ' days, ' + hours + ' hours, ' + minutes + ' minutes, and ' + seconds + ' seconds';
}
