
/*
 * GET home page.
 */

exports.init = function(req, res){
    console.log('test')
};

exports.index = function(req, res){
  res.render('user', { title: 'MARS "'+req.user.username+'"', username: req.user.username});
};