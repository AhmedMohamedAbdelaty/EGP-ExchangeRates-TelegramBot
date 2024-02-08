#!/bin/bash
# Compile the Java files
javac -cp ".:lib/*" src/main/java/*.java
# Run the main class
java -cp ".:lib/*:src/main/java" Main