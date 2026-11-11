model ChicagoCrimeSimulation

global {
	geometry shape <- rectangle(840.0, 600.0);

	float sim_hour <- 22.0;
	float spawn_rate <- 1.0;
	float criminal_ratio <- 0.25;
	float speed_factor <- 1.0;
	bool is_running <- true;
	int base_population <- 24;

	init {
		create resident number: 18 {
			location <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
			tgt <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
		}
		create criminal number: 6 {
			location <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
			tgt <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
		}
	}

	reflex advance_clock when: is_running {
		sim_hour <- sim_hour + 0.05;
		if (sim_hour >= 24.0) {
			sim_hour <- sim_hour - 24.0;
		}
	}

	reflex maintain_population when: is_running {
		float crowd_factor <- 0.7;
		if ((sim_hour >= 7.0 and sim_hour <= 9.0) or (sim_hour >= 17.0 and sim_hour <= 22.0)) {
			crowd_factor <- 1.25;
		} else if (sim_hour >= 11.0 and sim_hour <= 14.0) {
			crowd_factor <- 1.0;
		}

		int desired_total <- max(6, int(base_population * spawn_rate * crowd_factor));
		int desired_criminals <- max(1, int(desired_total * criminal_ratio));
		int desired_residents <- max(2, desired_total - desired_criminals);

		int missing_residents <- desired_residents - length(resident);
		int missing_criminals <- desired_criminals - length(criminal);

		if (missing_residents > 0) {
			create resident number: min(missing_residents, 4) {
				location <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
				tgt <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
			}
		}

		if (missing_criminals > 0) {
			create criminal number: min(missing_criminals, 2) {
				location <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
				tgt <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
			}
		}
	}
}

species resident {
	float speed <- 2.1;
	point tgt;

	reflex walk when: is_running {
		float dx <- tgt.x - location.x;
		float dy <- tgt.y - location.y;
		float d <- sqrt(dx * dx + dy * dy);
		float step_size <- speed * speed_factor;

		if (d <= step_size + 1.0) {
			location <- tgt;
			tgt <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
		} else {
			location <- {
				location.x + (dx / d) * step_size,
				location.y + (dy / d) * step_size
			};
		}
	}
}

species criminal {
	float speed <- 3.2;
	point tgt;

	reflex walk when: is_running {
		float dx <- tgt.x - location.x;
		float dy <- tgt.y - location.y;
		float d <- sqrt(dx * dx + dy * dy);
		float step_size <- speed * speed_factor;

		if (d <= step_size + 1.0) {
			location <- tgt;
			tgt <- {80.0 + rnd(680.0), 50.0 + rnd(500.0)};
		} else {
			location <- {
				location.x + (dx / d) * step_size,
				location.y + (dy / d) * step_size
			};
		}
	}
}

experiment ChicagoCrime type: gui {
	parameter "Simulation Hour" var: sim_hour min: 0 max: 23 step: 1;
	parameter "Spawn Rate" var: spawn_rate min: 0.2 max: 3.0 step: 0.1;
	parameter "Criminal Ratio" var: criminal_ratio min: 0.05 max: 0.6 step: 0.05;
	parameter "Speed Factor" var: speed_factor min: 0.4 max: 3.0 step: 0.1;
	parameter "Running" var: is_running;

	output {
		display main_display type: opengl {
			species resident;
			species criminal;
		}
	}
}
