var http = require('http');
var express = require('express');
var app = express();
var ejs = require('ejs');

var mongoose = require('mongoose');
var bcrypt = require('bcrypt');
var session = require('express-session');

const { ObjectId } = require('mongodb');

//for using post in forums
app.use(express.urlencoded({extended:true}))

//for parsing json requests
app.use(express.json());

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
let User;


// session for keeping users logged in
app.use(session({
    secret: 'secretkey', // use env var in prod
    resave: false,
    saveUninitialized: false
  }));

// function to authenticate login
function checkAuth(req, res, next) {
    if (req.session.userId) return next();
    res.redirect('/login');
  }

(async () => {
    try {
      await client.connect();
      db = client.db('EnterprizeWebCW');
      collection = db.collection('stories');
      User = db.collection('User')
    } catch (err) {
      console.error("Database connection failed:", err);
    }
  })();

// pages --------------------------------------

// get current path for navbar template rendering
app.use((req, res, next) => {
  // allow all templates to access username
  res.locals.username = req.session.username;
  res.locals.path = req.path;
  next();
  });

// home page
app.get('/', async(req, res) => {
    try {
        stories = await collection.find({}).toArray(); // get all stories as an array
        res.render('pages/homepage', { stories });
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

  // decide if story is posted under username or anonymously
    author = req.session.userId && !req.body.anonymous
    ? req.session.username
    : "Anonymous";

  // decide if story is public or private
    visibility = !req.body.private
    ? "public"
    : "private";

    const newstory = {
        title: req.body.title,
        story: req.body.story,
        genre: req.body.genre,
        author: author,
        totalrating: 0,
        numratings: 0,
        rating: 0, // this is the average rating
        visibility: visibility, // story can be public or private
    };
    
    db.collection('stories').insertOne(newstory, function(err, result) {
        if (err) throw err;
        console.log('saved to database')
        res.redirect('/')
        })
    res.render('pages/submittedstory');
});

// when a story is rated, submit rating to database
app.post('/rate', async (req, res) => {
    try {
        const { id, rating } = req.body;
        
        // get the new average rating
        story = await collection.findOne({ _id: new ObjectId(id) }); // TODO: maybe use ID instead?
        newTotal = story.totalrating + rating;
        newNum = story.numratings + 1;
        newRating = Math.round(newTotal / newNum);

        // add the rating to the total number of ratings and increment the number of ratings by 1
        const result = await collection.updateOne({ _id: new ObjectId(id) },
        { $inc: { totalrating: parseInt(rating), numratings: parseInt(1)}, $set: {rating: newRating} },
        );

        res.json({ success: true, modified: result.modifiedCount });
    } catch (err) {
        console.error("Error updating rating:", err);
        res.status(500).json({ success: false, error: err.message });
    }
    });

// sign up page
app.get('/signup', function(req, res){
    res.render('pages/signup');
});

app.post('/signup', async (req, res) => {
    hashedPassword = await bcrypt.hash(req.body.password, 10);
      newUser = {
        username: req.body.username,
        password: hashedPassword,
      };

    // find out if username already exists
    existing = await User.findOne({ username: newUser.username });
    if(existing){
        res.send("Username taken.")
    // add user to database
    } else if(newUser.username.toUpperCase() == "ANONYMOUS"){
      res.send('Invalid username.')
    }else {
        await User.insertOne(newUser);
        res.redirect('/login');
    }
    });

// login page
app.get('/login', function(req, res){
    res.render('pages/login');
});

app.post('/login', async (req,res) => {
    const user = await User.findOne({ username: req.body.username });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
      req.session.userId = user._id;
      req.session.username = user.username;
      req.session.loggedin = true;
      res.redirect('/');
    } else {
      res.send("Username or password is incorrect.");
    }
  });

// profile page for logged in users
app.get('/profile', async function(req,res){
  try {
    stories = await collection.find({author: req.session.username}).toArray(); // get user's stories
    console.log(stories);

    // calculate user's overall average rating
    // total up the rating of each story
    userTotalRating = 0;
    
    for (let i = 0; i < stories.length; i++) {
      userTotalRating += stories[i].rating;
    }
    userAvgRating = userTotalRating/stories.length;

    res.render('pages/profile', { stories, userAvgRating });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading profile');
  }
});  


app.listen(8080);
console.log("listening on port 8080");
