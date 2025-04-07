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

app.listen(8080);
console.log("listening on port 8080");

/* app.get('/', function(req, res){
res.send("Hello world! by express");
});
app.listen(8080); */