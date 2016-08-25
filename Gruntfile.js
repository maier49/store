module.exports = function (grunt) {
	const gruntConfig = {
		dtsGenerator: {
			options: {
				main: 'dojo-store-prototype/main'
			}
		},
		watch: {
			dev: {
				files: '**/*.ts',
				tasks: ['dev'],
				options: {
					spawn: false
				}
			}
		}
	};
	grunt.initConfig(gruntConfig);
	require('grunt-dojo2').initConfig(grunt, gruntConfig);

	grunt.loadNpmTasks('grunt-contrib-watch');
};
