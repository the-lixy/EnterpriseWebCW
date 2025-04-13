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
require('dotenv').config();

// using ejs for templating
app.set('view engine', 'ejs');

// cookie parser for saving users' viewed stories in a cookie
const cookieParser = require('cookie-parser');
app.use(cookieParser());

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

//function to generate random claim code for anonymous stories
function generateClaimCode(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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

// home page (filterable by genre)
app.get('/', async (req, res) => {
  const genre = req.query.genre; // from ?genre=...
  const validGenres = ['Adventure', 'Horror', 'Romance', 'Thriller', 'SciFi', 'Fantasy', 'Comedy', 'Fable', 'Misc'];
  const seen = req.query.seen; // if seen stories is unchecked this will be undefined
  const filterOption = {};

  if (genre && validGenres.includes(genre)) {
    filterOption.genre = genre;
  }

  // get user rankings
  userRanking = await User.find().sort({avgRating : -1}).toArray();
  //console.log(userRanking);
  // map user rankings
  userRankingMap = {};
  userRanking.forEach(user => {
    userRankingMap[user.username] = user.avgRating || 0;
  });

  try {

    // get stories matching the filter criteria
    const heading = genre ? `${genre} Stories` : "Popular Stories";
    let stories = await collection.find(filterOption).sort({ rating: -1, numratings: -1 }).toArray(); // sorted by highest rating then number of ratings

     //TODO: edit this to have an if statement (if author is anonymous ignore the ranking)
    // sort by user's overall ranking next
    stories = stories.sort((a,b) => 
      {
      const aAuthorRating = userRankingMap[a.author] || 0;
      const bAuthorRating = userRankingMap[b.author] || 0;
      return bAuthorRating - aAuthorRating;
    })

    // if seen is undefined
    if(!seen){
      // Check the "seenStories" cookie
      const seenStories = req.cookies.seenStories ? JSON.parse(req.cookies.seenStories) : [];

      // Filter out stories that the user has already seen
      stories = stories.filter(story => !seenStories.includes(story._id.toString()));
    };

    res.render('pages/homepage', { heading, stories, genre, seen });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading homepage');
  }
});

// story page
app.get('/story', async(req,res) => {
  const storyId = req.query.id;
  try {
    const story = await collection.findOne({ _id: new ObjectId(storyId) });
    res.render('pages/storypage', { story,  errorMessage: undefined });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading story');
  }
});

// claiming story
app.post('/story', async(req,res) => {
  try{
  //console.log("body ID received:", req.body.id);
  const storyId = req.body.id;
  claimedStory = await collection.findOne({ _id: new ObjectId(storyId)});

  //console.log("Claimed Story:", claimedStory);
  const inputCode = req.body.claimcode;
  const claimCode = claimedStory.claimcode;

  //console.log("user input: " + inputCode + " claimcode: " + claimCode);
  author = req.session.username;
  //console.log("author: " + author);
  
    
    if(inputCode == claimCode){
      //console.log("claimcode accepted")
      await db.collection('stories').updateOne({  _id: new ObjectId(storyId)}, { $set: { author : req.session.username } })
      //console.log("story updated")
      res.redirect(`/story?id=${storyId}`)

    }else {
      console.log("ERROR claimcode denied");

      // Pass an error message to the view
      res.render('pages/storypage', {
        story: claimedStory,
        errorMessage: 'Incorrect claim code. Please try again.' // Error message
      });
    }
  }catch(err){
    console.error(err);
    res.status(500).send('Error claiming story');
  };
});


// submit page
app.get('/submit', function(req, res) {
    res.render('pages/submit');
});

// when story is submitted, send it to database
app.post('/submittedstory', async(req, res) => {
  try{
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

    if (newstory.author === "Anonymous"){
      newstory.claimcode = generateClaimCode(10)
    };

    // pass story to the database
    result = await db.collection('stories').insertOne(newstory);

    //get id of created database entry
    storyId = result.insertedId;
    claimcode = newstory.claimcode;

    res.render('pages/submittedstory', { newstory, storyId,  username: req.session.username, claimcode });
  }catch (err) {
    // Catch any errors and log them
    console.error("Error submitting story:", err);
    res.status(500).send("Error submitting story");
    }
  });



// when a story is rated, submit rating to database
app.post('/rate', async (req, res) => {
    try {
        const { id, rating, previousRating} = req.body;
        
        let newTotal;
        let newNum;


        story = await collection.findOne({ _id: new ObjectId(id) });

        // if user has previously rated the story
        if (previousRating !== undefined && previousRating !== null) {
          newTotal = story.totalrating - previousRating + rating;
          newNum = story.numratings; // don't update number of ratings
        } else {
          // first time rating
          newTotal = story.totalrating + rating;
          newNum = story.numratings + 1;
        }
        
        newRating = Math.round(newTotal / newNum);
        //console.log("newTotal: " + newTotal + " newNum: " + newNum + " newRating: " + newRating);

        // update the story rating
        const result = await collection.updateOne({ _id: new ObjectId(id)}, {$set: {totalrating : parseInt(newTotal), numratings: parseInt(newNum), rating: parseInt(newRating)}});

        // update author's average rating

        // get all of user's stories
        author = story.author; // TODO: maybe change this to be id for security?
        stories = await collection.find({author: author}).toArray(); 

        userTotalRating = 0;

        for (let i = 0; i < stories.length; i++) {
          userTotalRating += stories[i].rating;
        }

        userAvgRating = Math.round(userTotalRating/stories.length);
        User.updateOne( { username: author }, { $set: { avgRating: userAvgRating } } ) 
        

        res.json({ success: true, modified: result.modifiedCount });
        res.redirect('/')
    } catch (err) {
        console.error("Error updating rating:", err);
        res.status(500).json({ success: false, error: err.message });
    }
    });

// when a user presses "delete" on their post, query the database
app.post('/delete', async(req,res) => {
  try{
    const {id} = req.body;
    await collection.deleteOne({ _id: new ObjectId(id) });
    //res.redirect('/');
  }catch (err) {
    console.error("Error deleting story:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// sign up page
app.get('/signup', function(req, res){
    if(req.session.loggedin){
      res.redirect('/');
      return;
    }else{
      res.render('pages/signup');
    }
    
});

app.post('/signup', async (req, res) => {
    hashedPassword = await bcrypt.hash(req.body.password, 10);
      newUser = {
        username: req.body.username,
        password: hashedPassword,
        avgRating: 0,
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
  if(req.session.loggedin){
    res.redirect('/');
    return;
  }else{
    res.render('pages/login', { errorMessage: undefined });
  }
});

app.post('/login', async (req,res) => {
  const user = await User.findOne({ username: req.body.username });
  if (user && await bcrypt.compare(req.body.password, user.password)) {
    req.session.userId = user._id;
    req.session.username = user.username;
    req.session.loggedin = true;
    res.redirect('/');
  } else {
    res.render('pages/login', { errorMessage: 'Username or password is incorrect.' });
  }
});

 // log out feature
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      res.status(500).send("Logout failed.");
    } else {
      // Force reload to reset navbar state
      res.redirect('/');
    }
  });
});

// profile page for logged in users
app.get('/profile', async function(req,res){
  if(!req.session.loggedin){
    res.redirect('/');
    return;
  }else{
    try {
      
      userInfo = await User.findOne({username: req.session.username});
      userAvgRating = userInfo.avgRating

      stories = await collection.find({author: req.session.username}).toArray(); // get user's stories

      res.render('pages/profile', { stories, userAvgRating });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error loading profile');
    }
  }
});  


app.listen(8080);
console.log("listening on port 8080");
