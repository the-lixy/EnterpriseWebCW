var http = require('http');
var express = require('express');
var app = express();
var ejs = require('ejs');

// using ejs for templating
app.set('view engine', 'ejs');

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
