const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/ttslive')
.then(() => {
  console.log('MongoDB connection SUCCESS');
  process.exit(0);
})
.catch(err => {
  console.error('MongoDB connection FAILED:', err);
  process.exit(1);
});
