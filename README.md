# coffeemode

CoffeeMode MonoRepo

## Components

- /coffeemode_backend  
run Dockerfile
- docker build -t coffeemode-backend .
  Outdated: docker run -d -p 8080:8080 -e "MONGO_URI=mongodb://coffee_mode:coffee_mode@101.100.172.187:26017/coffeemode?authSource=admin&authMechanism=SCRAM-SHA-256" -e MONGO_DB=coffeemode -e REDIS_HOST=host.docker.internal --name coffeemode-backend coffeemode-backend
  Latest: docker run -d -p 8080:8080 -e "MONGO_URI=mongodb://cafe_mode:CafeMode@Work@101.100.172.187:26017/coffeemode?authSource=admin&authMechanism=SCRAM-SHA-256" -e MONGO_DB=coffeemode -e REDIS_HOST=host.docker.internal --name coffeemode-backend coffeemode-backend
- /coffeemode_frontend
- /coffeemode_script

## Tech Stack

- Spring Boot
- React
- Cloudflare Workers Wrangler
