var http = require('http');
var express = require('express');
var app = express();
var ejs = require('ejs');

// load environment variables
require('dotenv').config(); // Load variables from .env

// using ejs for templating
app.set('view engine', 'ejs');

// MongoDB setup
const { MongoClient } = require('mongodb');
// environment variable for database security
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
// try and get first post in stories collection
async function run() {
  try {
    await client.connect();
    const db = client.db('EnterprizeWebCW');
    const collection = db.collection('stories');

    // Find the first document in the collection
    const first = await collection.findOne();
  } finally {
    // Close the database connection when finished or an error occurs
    await client.close();
  }
}
run().catch(console.error);

// pages

// home page
app.get('/', function(req, res){
    res.render('pages/homepage');
});

// submit page
app.get('/submit', function(req, res){
    res.render('pages/submit');
});

// when story is submitted
app.get('/submittedstory', function(req, res){
    res.render('pages/submittedstory');
});

// login page
app.get('/login', function(req, res){
    res.render('pages/login');
});

app.listen(8080);
console.log("listening on port 8080");
