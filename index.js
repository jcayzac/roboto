var async = require('async'),
	irc = require('irc'),
	memcached = require('memcached'),
	conf = require('./config.json')

var store = new memcached(conf.membase.hosts, conf.membase.options || {}),
	prefix = 'roboto/' + conf.server + '/',
	master_stats

var bot = new irc.Client(conf.server, conf.nick, {
		userName: 'Roboto',
		realName: 'IRC logger bot',
		//autoConnect: false
	})

bot.on('error', function(message) {
	// whois of myself returned nothing,
	// so it means I can get my nick back.
	message = message || {}
	message.args = message.args || []
	if (message.command === "err_nosuchnick" &&
		message.args[1] === conf.nick &&
		bot.nick !== conf.nick
	) {
		return bot.send('NICK', conf.nick)
	}

	// something went wrong
	throw new Error('CLIENT ERROR: ' + JSON.stringify(message));
})
.on('whois', function (info) {
	info = info || {}
	if (info.nick === conf.nick && bot.nick !== conf.nick) {
		// Whois of myself returned someone else.
		// Continue calling whois until I get my nick back...
		setTimeout(function () {
			bot.whois(conf.nick)
		}, 5000)
	}
})
.on('nick', function (old_nick, new_nick, channels) {
	// I have been assigned a new nick
	if (new_nick === bot.nick && new_nick !== conf.nick) {
		// Let's see who stole my identity!
		bot.whois(conf.nick)
	}
})
.on('message#', function (from, channel, message) {
	var msgid = (typeof master_stats.last === "number") ? 1 + master_stats.last : 0,
		msg = {date: Date.now(), from: from, channel: channel, message: message };

	store.set(prefix + 'm/' + msgid, msg, 0, function (err, ok) {
		if (err || !ok) return console.log("Something screwed up");
		master_stats.last = msgid;
		store.set(prefix + 'stats', master_stats, 0, function (err, ok) {
			if (err || !ok) return console.log("Something screwed up");
		})
	})
})
.on('pm', function (from, message) {
	var m
	console.log(from + ' => ME: ' + message);

	if (m = /^last(?:\s+(\d+)(?:\s+([^\s]+))?)?/.exec(message)) {
		var only_channel = m[2]
		if (only_channel && only_channel[0] !== '#')
			only_channel = '#' + only_channel

		if (typeof master_stats.last !== "number")
			return bot.say(from, 'Nothing yet!')
		else {
			var start = master_stats.last - Number(m[1] || 50)
			if (start < 0) start = 0
			var keys = []
			while (start < master_stats.last) {
				keys.push(prefix + 'm/' + (++start))
			}
			if (!keys.length) return bot.say(from, 'Nothing yet!')
			store.get(keys, function (err, messages) {
				if (err) return bot.say(from, err)
				messages = messages || {}
				for (var k in keys) {
					k = keys[k];
					var msg = messages[k];
					if (!msg) continue;
					if (only_channel && msg.channel !== only_channel) continue;

					bot.say(from, [
						Date(msg.date).toString(),
						" [",
						msg.channel,
						"] ",
						msg.from,
						": ",
						msg.message
					].join(''))
				}
			})
		}
	}
})
.on('join', function (channel, who) {
	console.log(who + ' joined ' + channel);
})
.on('part', function (channel, who) {
	console.log(who + ' left ' + channel);
})
.on('kick', function (channel, who) {
	console.log(who + ' left ' + channel);
	// If it's me I'll attempt to rejoin
})
.on('kill', function (channel, who) {
	console.log(who + ' left ' + channel);
	// If it's me I'll attempt to rejoin
})
.on('invite', function (channel, from, message) {
	this.join(channel);
})
.on('channellist_item', function (channel) {
	this.join(channel.name);
})
.on('motd', function (motd) {
	store.get(prefix + 'stats', function (err, stats) {
		if (err) throw new Error(err);
		master_stats = stats || {}
		console.log(JSON.stringify(master_stats));

		if (bot.nick !== conf.nick) {
			console.log("I couldn't get the nick I wanted >.<")
			bot.whois(conf.nick)
		}

		// If no channel list is provided, attempt to join all channels
		if (conf.channels) {
			conf.channels.split(/\s*,\s*/).forEach(bot.join.bind(bot))
		}
		else {
			console.log("No channel list provided. Joining every channel...")
			this.list()
		}
	})
});


