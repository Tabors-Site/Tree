const mongoose = require("mongoose");
const bcrypt = require("bcrypt"); // To securely hash passwords
const { v4: uuidv4 } = require("uuid");

const UserSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: uuidv4 },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  
  roots: [{ type: String, ref: "Node" }],
});

// Hash password before saving
UserSchema.pre("save", async function (next) {
  if (this.isModified("password") || this.isNew) {
    const salt = await bcrypt.genSalt(10); // 10 rounds of salting
    this.password = await bcrypt.hash(this.password, salt); // Hash the password
  }
  next();
});

//compare the plain password with the hashed password
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Create the User model
const User = mongoose.model("User", UserSchema);
module.exports = User;
