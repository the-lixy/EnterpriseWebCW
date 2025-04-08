var http = require('http');
var express = require('express');
var app = express();
var ejs = require('ejs');

//for using post in forums
app.use(express.urlencoded({extended:true}))

// load environment variables
require('dotenv').config(); // Load variables from .env

// using ejs for templating
app.set('view engine', 'ejs');

// MongoDB setup
const { MongoClient } = require('mongodb');
// environment variable for database security
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;
let collection;

(async () => {
    try {
      await client.connect();
      db = client.db('EnterprizeWebCW');
      collection = db.collection('stories');
    } catch (err) {
      console.error("Database connection failed:", err);
    }
  })();

// pages --------------------------------------

// home page
app.get('/', async(req, res) => {
    try {
        const story = await collection.findOne(); // get first story
        res.render('pages/homepage', { story });
      } catch (err) {
        console.error(err);
        res.status(500).send('Error loading homepage');
      }
    });

// submit page
app.get('/submit', function(req, res){
    res.render('pages/submit');
});

// when story is submitted, send it to database
app.post('/submittedstory', function(req, res){
    const newstory = {
        title: req.body.title,
        story: req.body.story,
        genre: req.body.genre,
        author: "Anonymous", // I want to change this later!
        rating: 0,
    };
    
    db.collection('stories').insertOne(newstory, function(err, result) {
        if (err) throw err;
        console.log('saved to database')
        res.redirect('/')
        })
    res.render('pages/submittedstory');
});

// login page
app.get('/login', function(req, res){
    res.render('pages/login');
});

app.listen(8080);
console.log("listening on port 8080");
