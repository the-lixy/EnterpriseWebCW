import http from 'http';
import express from 'express';
import ejs from 'ejs';

import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import session from 'express-session';

import { ObjectId } from 'mongodb';
import axios from 'axios'; // for captcha verification

const app = express();

// for using post in forums
app.use(express.urlencoded({ extended: true }));

// for parsing json requests
app.use(express.json());

// load environment variables
import dotenv from 'dotenv';
dotenv.config();

// using ejs for templating
app.set('view engine', 'ejs');

// cookie parser for saving users' viewed stories in a cookie
import cookieParser from 'cookie-parser';
app.use(cookieParser());

// public folder for css file
app.use(express.static('public'));

// MongoDB setup
import { MongoClient } from 'mongodb';
// environment variable for database security
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

// Declare db variable here so you can access it throughout the code
let db;
let collection;
let User;

// Connect to MongoDB and assign collection references
(async () => {
  try {
    await client.connect();
    db = client.db('EnterprizeWebCW');
    collection = db.collection('stories');
    User = db.collection('User'); // Assign User collection here
  } catch (err) {
    console.error("Database connection failed:", err);
  }
})();

// session for keeping users logged in
app.use(
  session({
    secret: 'secretkey', // use env var in prod
    resave: false,
    saveUninitialized: false
  })
);

// function to authenticate login
function checkAuth(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

// function to generate random claim code for anonymous stories
function generateClaimCode(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

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
  let userRanking = await User.find().sort({ avgRating: -1 }).toArray();
  let userRankingMap = {};
  userRanking.forEach((user) => {
    userRankingMap[user.username] = user.avgRating || 0;
  });

  try {
    // get stories matching the filter criteria
    const heading = genre ? `${genre} Stories` : "Popular Stories";
    let stories = await collection
      .find(filterOption)
      .sort({ rating: -1, numratings: -1 })
      .toArray(); // sorted by highest rating then number of ratings

    // sort by user's overall ranking next
    stories = stories.sort((a, b) => {
      if (a.author == "Anonymous" || b.author == "Anonymous") {
        // ignore anonymous author ranking
        return 0;
      } else {
        const aAuthorRating = userRankingMap[a.author] || 0;
        const bAuthorRating = userRankingMap[b.author] || 0;
        return bAuthorRating - aAuthorRating;
      }
    });

    // if seen is undefined
    if (!seen) {
      let viewedStoryIds = [];

      // logged-in users: fetch viewed stories from DB
      if (req.session.userId) {
        const user = await User.findOne({ _id: new ObjectId(req.session.userId) });
        viewedStoryIds = user?.viewedStories?.map((id) => id.toString()) || [];
      } else {
        // guest users: fetch viewed stories from cookies
        viewedStoryIds = req.cookies.seenStories ? JSON.parse(req.cookies.seenStories) : [];
      }

      // Filter out stories that the user has already seen
      stories = stories.filter((story) => !viewedStoryIds.includes(story._id.toString()));
    }

    // find top rater on the site
    const topRaterAgg = await db.collection('ratings').aggregate([
      {
        $group: {
          _id: "$userId",          // group by user
          ratingCount: { $sum: 1 } // count ratings
        }
      },
      {
        $sort: { ratingCount: -1 } // highest first
      },
      {
        $limit: 1
      }
    ]).toArray();

    let topRater = null;
    if (topRaterAgg.length > 0) {
      const topUserId = topRaterAgg[0]._id;
      const topUser = await User.findOne({ _id: new ObjectId(topUserId) });
      if (topUser) {
        topRater = {
          username: topUser.username,
          ratingCount: topRaterAgg[0].ratingCount
        };
      }
    }

    res.render('pages/homepage', { heading, stories, genre, seen, topRater });
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

    // check CAPTCHA protection
    if (story.captchaprotected == "true" && !req.session.loggedin) {
      const passed = req.session.captchaPassedFor?.includes(storyId);
      if (!passed) {
        req.session.requestedStoryId = storyId;
        return res.redirect('/verify-captcha');
      };
    };

    // mark story as seen
    if(req.session.userId){
      // logged in users (save to db)
      await User.updateOne({ _id: new ObjectId(req.session.userId) }, { $addToSet: { viewedStories: story._id } }); // avoids duplicates 

      // add story genre to user's genre totals
      await User.updateOne({ _id: new ObjectId(req.session.userId) },{ $inc: { [`genreCounts.${story.genre}`]: 1 } });
    }else{
      // guest users (update cookie)
      let seenStories = req.cookies.seenStories ? JSON.parse(req.cookies.seenStories) : [];
      if (!seenStories.includes(storyId)) {
        seenStories.push(storyId);
        res.cookie('seenStories', JSON.stringify(seenStories), {
          maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
          httpOnly: false, // needs to be readable by client (optional)
        });
      }
    };

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
  let claimedStory = await collection.findOne({ _id: new ObjectId(storyId)});

  //console.log("Claimed Story:", claimedStory);
  const inputCode = req.body.claimcode;
  const claimCode = claimedStory.claimcode;

  //console.log("user input: " + inputCode + " claimcode: " + claimCode);
  let author = req.session.username;
  //console.log("author: " + author);
  
    
    if(inputCode == claimCode){
      //console.log("claimcode accepted")
      await db.collection('stories').updateOne({  _id: new ObjectId(storyId)}, { $set: { author : author } })

      // update author's average rating
      // get all of user's stories
      const stories = await collection.find({author: author}).toArray(); 

      let userTotalRating = 0;

      for (let i = 0; i < stories.length; i++) {
        userTotalRating += stories[i].rating;
      }

      let userAvgRating = Math.round(userTotalRating/stories.length);
      User.updateOne( { username: author }, { $set: { avgRating: userAvgRating } } ); 
      
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
    let author = req.session.userId && !req.body.anonymous
    ? req.session.username
    : "Anonymous";

  // decide if story is public or private
    let visibility = !req.body.private
    ? "public"
    : "private";

    // decide if story is captcha protected
    let captchaprotected = !req.body.captchaprotected
    ? "false"
    : "true";

    const newstory = {
        title: req.body.title,
        story: req.body.story,
        genre: req.body.genre,
        author: author,
        totalrating: 0,
        numratings: 0,
        rating: 0, // this is the average rating
        visibility: visibility, // story can be public or private
        captchaprotected: captchaprotected, // optional anti-web scraping
    };

    if (newstory.author === "Anonymous"){
      newstory.claimcode = generateClaimCode(10)
    };

    // pass story to the database
    const result = await db.collection('stories').insertOne(newstory);

    //get id of created database entry
    let storyId = result.insertedId;
    let claimcode = newstory.claimcode;

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
      let story = await collection.findOne({ _id: new ObjectId(id) });
      if (!story) return res.status(404).json({ success: false, message: "Story not found" });
      
      let newTotal;
      let newNum;

      // if user is logged in
      if(req.session.userId){
        let userId = req.session.userId;
        let storyId = new ObjectId(story._id);
        let existingrating = await db.collection('ratings').findOne({ userId, storyId: new ObjectId(storyId)});

        if(existingrating){
          newTotal = story.totalrating - previousRating + rating;
          newNum = story.numratings; // don't update number of ratings

          await db.collection('ratings').updateOne({ userId, storyId: new ObjectId(storyId) }, {$set: {rating} });
        }else{
          newTotal = story.totalrating + rating;
          newNum = story.numratings + 1;

          await db.collection('ratings').insertOne({ userId, storyId: new ObjectId(storyId), rating });
        };
      }

      // guest user
      else{
        if (previousRating !== undefined && previousRating !== null) {
          newTotal = story.totalrating - previousRating + rating;
          newNum = story.numratings; // don't update number of ratings
        } else {
          // first time rating
          newTotal = story.totalrating + rating;
          newNum = story.numratings + 1;
        }
      }
      
      const newRating = Math.round(newTotal / newNum);

      const result = await collection.updateOne({ _id: new ObjectId(id)}, {$set: {totalrating : parseInt(newTotal), numratings: parseInt(newNum), rating: parseInt(newRating)}});

      // update author's average rating
      // get all of user's stories
      let author = story.author;
      const stories = await collection.find({author: author}).toArray(); 

      let userTotalRating = 0;

      for (let i = 0; i < stories.length; i++) {
        userTotalRating += stories[i].rating;
      }

      let userAvgRating = Math.round(userTotalRating/stories.length);
      User.updateOne( { username: author }, { $set: { avgRating: userAvgRating } } ); 
      

      res.json({ success: true, modified: result.modifiedCount });
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
      res.render('pages/signup', { errorMessage: undefined });
    }
    
});

app.post('/signup', async (req, res) => {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const newUser = {
        username: req.body.username,
        password: hashedPassword,
        avgRating: 0,
        viewedStories: [],
        genreCounts: {},
      };

    // find out if username already exists
    const existing = await User.findOne({ username: newUser.username });
    if(existing){
      res.render('pages/signup', { errorMessage: "Username taken." });
    // don't allow "anonymous" as username
    } else if(newUser.username.toUpperCase() == "ANONYMOUS"){
      res.render('pages/signup', { errorMessage: "Invalid username" });
    }else {
        // add user to database
        const result = await User.insertOne(newUser);
        req.session.userId = result.insertedId;
        req.session.username = newUser.username;
        req.session.loggedin = true;
        //console.log("New session userId:", req.session.userId, " New session username: ", req.session.username);
        res.redirect('/profile');
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
      
      let userInfo = await User.findOne({username: req.session.username});
      let userAvgRating = userInfo.avgRating;
      let username = req.session.username;

      let stories = await collection.find({author: req.session.username}).toArray(); // get user's stories

      res.render('pages/profile', { stories, userAvgRating, username });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error loading profile');
    }
  }
});  

// route to verify captcha
app.get('/verify-captcha', (req, res) => {
  if (!req.session.requestedStoryId) {
    return res.redirect('/');
  }
  res.render('pages/verify-captcha');
});

app.post('/verify-captcha', async (req, res) => {
  const captchaResponse = req.body['g-recaptcha-response'];
  const secretKey = process.env.RECAPTCHA_SECRET;

  try {
    const result = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaResponse}`
    );

    if (result.data.success) {
      const storyId = req.session.requestedStoryId;
      req.session.captchaPassedFor = req.session.captchaPassedFor || [];
      req.session.captchaPassedFor.push(storyId);
      delete req.session.requestedStoryId;
      return res.redirect(`/story?id=${storyId}`);
    } else {
      res.send('CAPTCHA failed. Please try again.');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('CAPTCHA verification error');
  }
});

// "for you" page sorted by user's top genres
app.get('/foryou', async (req, res) => {

  if(!req.session.loggedin){
    res.redirect('/');
    return;
  }else{
    const genre = req.query.genre;
    const validGenres = ['Adventure', 'Horror', 'Romance', 'Thriller', 'SciFi', 'Fantasy', 'Comedy', 'Fable', 'Misc'];
    const seen = req.query.seen;
    const filterOption = {};

    if (genre && validGenres.includes(genre)) {
      filterOption.genre = genre;
    }

    // Get all stories based on filter
    let stories = await collection.find(filterOption).toArray();

    // Get user rankings
    const userRanking = await User.find().sort({ avgRating: -1 }).toArray();
    const userRankingMap = {};
    userRanking.forEach(user => {
      userRankingMap[user.username] = user.avgRating || 0;
    });

    // Sort by author ranking (ignore anonymous)
    stories = stories.sort((a, b) => {
      if (a.author === "Anonymous" || b.author === "Anonymous") return 0;
      return (userRankingMap[b.author] || 0) - (userRankingMap[a.author] || 0);
    });

    // Filter out seen stories
    if (!seen) {
      let viewedStoryIds = [];
      if (req.session.userId) {
        const user = await User.findOne({ _id: new ObjectId(req.session.userId) });
        viewedStoryIds = user?.viewedStories?.map(id => id.toString()) || [];

        // Sort by user's favorite genres
        if (!genre && user.genreCounts) {
          const sortedGenres = Object.entries(user.genreCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([genre]) => genre);

          // Prioritize stories matching top genres
          stories = stories.sort((a, b) => {
            const aPriority = sortedGenres.indexOf(a.genre);
            const bPriority = sortedGenres.indexOf(b.genre);
            return (aPriority === -1 ? Infinity : aPriority) - (bPriority === -1 ? Infinity : bPriority);
          });
        }

      } else {
        // Guest user
        viewedStoryIds = req.cookies.seenStories ? JSON.parse(req.cookies.seenStories) : [];
      }

      stories = stories.filter(story => !viewedStoryIds.includes(story._id.toString()));
    }

    // Get top rater info
    const topRaterAgg = await db.collection('ratings').aggregate([
      { $group: { _id: "$userId", ratingCount: { $sum: 1 } } },
      { $sort: { ratingCount: -1 } },
      { $limit: 1 }
    ]).toArray();

    let topRater = null;
    if (topRaterAgg.length > 0) {
      const topUser = await User.findOne({ _id: new ObjectId(topRaterAgg[0]._id) });
      if (topUser) {
        topRater = {
          username: topUser.username,
          ratingCount: topRaterAgg[0].ratingCount
        };
      }
    }

    res.render('pages/foryou', { stories, genre, seen, topRater });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});