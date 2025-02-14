const isAuthenticated = (req, res, next) => {
    console.log('Checking authentication:', req.session.user); // Log session check
    if (req.session && req.session.user) {
        next(); // User is authenticated
    } else {
        res.status(403).send('Access denied. Please log in.');
    }
};

module.exports = isAuthenticated;