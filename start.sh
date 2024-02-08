#!/bin/bash
# Compile the Java files
javac -cp .:lib/telegrambots-6.9.7.0.jar src/main/java/Main.java
# Run the main class
java -cp .:lib/telegrambots-6.9.7.0.jar src/main/java/Main