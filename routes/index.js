// Routes
exports.get_index = function(req, res) {
	if(!users[req.cookies['id']]) {
		res.render('index', { title: 'BigBlueButton HTML5 Client' });
	}
	else {
		res.redirect('/chat');
	}
};

exports.post_chat = function(req, res) {
  if(req.body.user.name && req.body.meeting.id) {
	  users[req.sessionID] = { username: req.body.user.name, meetingID: req.body.meeting.id, sockets: { }, refreshing: false, duplicateSession: false }; //sets a relationship between session id & name/sockets
	  res.cookie('id', req.sessionID); //save the id so socketio can get the username
	  res.redirect('/chat');
  }
  else res.redirect('/');
};

exports.logout = function(req, res) {
	req.session.destroy(); //end the session
	res.cookie('id', null); //clear the cookie from the machine
};

exports.get_chat = function(req, res) {
	//requiresLogin before this verifies that a user is logged in...
	res.render('chat', { title: 'BigBlueButton HTML5 Chat', user: users[req.cookies['id']]['username'] });
};

exports.error404 = function(req, res) {
	res.send('Page not found', 404);
};
