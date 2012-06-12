/**
 * Module dependencies.
 */
//default global variables
users = { }; //global variable for (temporary) datastore
max_chat_length = 140;
max_username_length = 30;
max_meetingid_length = 10;


var express = require('express')
	, routes = require('./routes')
	, app = module.exports = express.createServer()
	, io = require('socket.io').listen(app)
	, RedisStore = require('connect-redis')(express)
	, redis = require("redis")
	, pub = redis.createClient()
	, sub = redis.createClient();
	
	sub.psubscribe('*');

// Configuration

app.configure(function(){
	app.set('views', __dirname + '/views');
	app.set('view engine', 'jade');
	app.use(express['static'](__dirname + '/public'));
	app.use(express.bodyParser());
	app.use(express.methodOverride());
	app.use(express.cookieParser());
	app.use(express.session({
		secret: "password",
		cookie: { secure: true },
		store: new RedisStore({
			host: "127.0.0.1",
			port: "6379",
			db: "name_of_my_local_db"
		}),
		key: 'express.sid'
	}));
	app.use(app.router);
});

app.configure('development', function(){
	app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
	
});

app.configure('production', function(){
	app.use(express.errorHandler());
});

// If a page requires authentication to view...
function requiresLogin(req, res, next) {
	//check that they have a cookie with valid session id
	if(users[req.cookies['id']]) {
		next();
	} else {
		res.redirect('/');
	}
}

// Routes (see /routes/index.js)
app.get('/', routes.get_index);
app.post('/chat',  routes.post_chat);
app.post('/logout', requiresLogin, routes.logout);
app.get('/chat', requiresLogin, routes.get_chat);

// --- 404 (keep as last route) --- //
//app.get('*', routes.error404);

// Start the web server listening
app.listen(3000, function() {
	console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});

// Socket.IO Routes

/* 
  This verifies with the database that the sessionID
  contained within the connected socket is indeed valid.
  If the sessionID is not valid, the socket is disconnected
  and the function returns false.

  This test is to be used whenever a connected socket requests
  to make actions against the server i.e. sends a message to the server.
*/
function is_valid_connected(socket) {
	if(!users[socket.handshake.sessionID]) {
		socket.disconnect();
		return false;
	}
	else return true;
};

// Used to parse the cookie data.
function getCookie(cookie_string, c_var) {
	var i,x,y,ARRcookies=cookie_string.split(";");
	for (i=0;i<ARRcookies.length;i++) {
		x=ARRcookies[i].substr(0,ARRcookies[i].indexOf("="));
		y=ARRcookies[i].substr(ARRcookies[i].indexOf("=")+1);
		x=x.replace(/^\s+|\s+$/g,"");
		if (x==c_var) {
			return unescape(y);
		}
	}
}

io.configure(function () {
  io.set('authorization', function (handshakeData, callback) {
    //console.log(handshakeData);
    var id = handshakeData.sessionID = getCookie(handshakeData.headers.cookie, "id");
    if(!users[id]) {
      console.log("Invalid sessionID");
      callback(null, false); //failed authorization
    }
    else {
      handshakeData.username = users[id]['username'];
      handshakeData.meetingID = users[id]['meetingID'];
      callback(null, true); // error first callback style
    }
  });
});

// When someone connects to the websocket.
io.sockets.on('connection', function(socket) {
	//When a user sends a message...
	socket.on('msg', function(msg) {
	  if(is_valid_connected(socket)) {
	    if(msg.length > max_chat_length) {
  	    pub.publish(socket.handshake.sessionID, JSON.stringify(['msg', "System", "Message too long."]));
  	  }
  	  else {
	      var username = socket.handshake.username;
  	    var meetingID = socket.handshake.meetingID;
        pub.publish(meetingID, JSON.stringify(['msg', username, msg]));
      }
	  }
	});

	// When a user connects to the socket...
	socket.on('user connect', function() {
		if(is_valid_connected(socket)) {
		  var handshake = socket.handshake;
  		var sessionID = handshake.sessionID;
  		var meetingID = handshake.meetingID;
    	var username = handshake.username;
    	var socketID = socket.id;
    	
      socket.join(meetingID); //join the socket Room with value of the meetingID
      socket.join(sessionID); //join the socket Room with value of the sessionID
      
      //add socket to list of sockets.
      users[sessionID]['sockets'][socketID] = true;
      if((users[sessionID]['refreshing'] == false) && (users[sessionID]['duplicateSession'] == false)) {
        //all of the next sessions created with this sessionID are duplicates
        users[sessionID]['duplicateSession'] = true;
        pub.publish(meetingID, JSON.stringify(['user connect', username]));
			}
			else users[sessionID]['refreshing'] = false;
		}
	});

	// When a user disconnects from the socket...
	socket.on('disconnect', function () {
	  var handshake = socket.handshake;
		var sessionID = handshake.sessionID;
		if(users[sessionID]) { //socket is gone, so check database
		  var meetingID = handshake.meetingID;
		  var username = handshake.username;
  		var socketID = socket.id;
  		
			users[sessionID]['refreshing'] = true; //assume they are refreshing...
			//wait one second, then check if there are 0 sockets...
			setTimeout(function() {
				if(users[sessionID]) {
					delete users[sessionID]['sockets'][sessionID]; //socket has been disconnected
					if(Object.keys(users[sessionID]['sockets']).length == 0) {
						delete users[sessionID]; //delete the user from the datastore
						pub.publish(meetingID, JSON.stringify(['user disconnected', username])); //tell everyone they disconnected
					}
				}
				else {
					pub.publish(meetingID, JSON.stringify(['user disconnected', username])); //tell everyone they disconnected
				}
			}, 1000);
		}
	});
  
  // When the user logs out
	socket.on('logout', function() {
		if(is_valid_connected(socket)) {
		  //initialize local variables
		  var handshake = socket.handshake;
		  var sessionID = handshake.sessionID;
		  var meetingID = handshake.meetingID;
		  var username = handshake.username;
      
      delete users[sessionID]; //delete user from datastore
			pub.publish(sessionID, JSON.stringify(['logout'])); //send to all users on same session (all tabs)
  		socket.disconnect(); //disconnect own socket
		}
		pub.publish(meetingID, JSON.stringify(['user disconnected', username])); //tell everyone you have disconnected
	});
});

// Redis Routes

//When sub gets a message from pub
sub.on("pmessage", function(pattern, channel, message) {
  var channel_viewers = io.sockets['in'](channel);
  var params = JSON.parse(message);
  channel_viewers.emit.apply(channel_viewers, params);
});
