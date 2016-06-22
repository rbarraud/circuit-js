var Circus = (function(){

'use strict'

var FSTATE = 'fs', cid = 0, extensions={}
var AFTER = 'after'
var BEFORE = 'before'

function _Signal() {}

function extend(ctx, ext) {
  var args = [].slice.call(arguments,2)
  if (ext) {
    Object.keys(ext).forEach(function(k){
      ctx[k] = ext[k]
    })
    args.unshift(ctx)
    ctx = extend.apply(null, args)
  }
  return ctx
}

function Circus() {

  // public
  this.stateChange = function(s,e) {
    _events.unshift({start:s,stop:e||function(){}})
  }

  var createSignal = this.signal = function(name) {
    return appExtentions.reduce(function(s,ext){
      return s.extend(ext)
    }, new Signal(name))
  }

  this.asSignal = function() {
    return this.signal()
  }

  this.extend = function(ext){
    if (typeof ext==='function') appExtentions.push(ext)
    else extend(_proto,ext)
  }

  // private
  var _events = [], appExtentions = [], _proto

  // Circuits are in a steady state when not propagating. When
  // a value is introduced at any point in the circuit and at
  // any time, a propagationStarts event is raised. The circuit
  // will propagate until all of the signals have reached a
  // new steady state and a propagationEnds event is raised.
  var activeCircuit=0, stableCircuit=true
  function propagationStarts(ctx, v){
    if (!activeCircuit++ && stableCircuit && _events.length) {
      for (var i=0,el=_events.length; i < el; i++) {
        _events[i].start(ctx,v)
      }
    }
  }

  function propagationEnds(ctx,v){
    // Circuit propagation states are re-entrant. Any 'extra'
    // circuit work performed in this state will simply prolong
    // it until eventually there are no more value updates.
    if (!(--activeCircuit) && _events.length) {
      if (stableCircuit) {
        stableCircuit = false
        for (var i=0,el=_events.length; i < el; i++) {
          _events[i].stop(ctx,v)
        }
      }
      else stableCircuit = true
    }
  }

  // Generate a new signal
  function Signal(_name){

    // private
    var _ctx = this
    var _head, _state, _active, _pulse = Circus.FALSE
    var _reset = []
    var _astep = 0, _step = 0, _steps = [], _finallys = []
    var _pure, _after, _fail
    var _diff = function(v1, v2) {return v1!==v2}

    // _runToState - next step
    function _runToState(v,ns,_b) {
      var nv
      propagationStarts(_ctx, v)
      if (v instanceof Circus.fail) {
        _fail = nv = _fail || v
      }
      else if (_active!==false && (!_pure || _diff(v,_head,_ctx.isJoin))) {
        _head = _pure && v
        nv = v
        // steps in FIFO order
        for (var i = ns, il = _steps.length; i < il && _active!==false; i++) {
          nv = _b(_steps[i], [v])
          if (nv===undefined || nv instanceof Circus.fail) break;
          v = nv
        }
        _mutate(v,nv)
      }

      // finallys in FILO order - last value
      if (nv!==undefined) {
        for (var f = 0, fl = _finallys.length; f < fl; f++) {
          _finallys[f].call(_ctx, nv)
        }
      }

      if (_pulse!==Circus.FALSE) _mutate(_pulse)

      propagationEnds(_ctx, _state)
      return nv
    }

    function _mutate(v,nv) {
      _fail = nv instanceof Circus.fail && nv, _active = nv===undefined || _fail? undefined : true
      if (v && v.state===FSTATE) v = v.value
      _state=v
    }

    function _bindEach(f,args) {
      return f.apply(_ctx, args)
    }

    function _bind(f) {
      if (Circus.isSignal(f)) {
        f = f.value
      }
      else if (typeof f === 'object' && _ctx.channels) {
        for(var p in f) if (f.hasOwnProperty(p)) {
          var s = _ctx.asSignal(f[p])
          _ctx.channels[p]=s
          return _bind(s)
        }
      }
      return f
    }

    function _functor(f) {
      var _f = _bind(f)
      if (f!==_f && f.finally) f.finally(_next())
      if ( Circus.isAsync(_f) ) {
        var done = _next()
        return function async(v) {
          propagationStarts(_ctx,v)
          try {
            var args = [].slice.call(arguments).concat(done)
            return _f.apply(_ctx, args)
          }
          finally {
            propagationEnds(_ctx,v)
          }
        }
      }
      return _f
    }

    // Identity returns self. Useful for passive joins
    function _identity(ctx){
      ctx.$id= ++cid
      ctx.name = _name
      ctx.id = function() {return _ctx}
      ctx.id.constructor = _Signal
    }

    // Allow values to be injected into the signal at arbitrary step points.
    // State propagation continues from this point
    function _next(restep) {
      var next = _after? _steps.length : _step
      var ns = restep? next : next+1
      return function(v){
        _runToState(v,ns,_bindEach)
      }
    }

    _identity(_ctx)

    // public

    this.name = _name

    this.asSignal = function(v) {
      if (Circus.isSignal(v || this)) return v || this
      var s = createSignal()
      return (typeof v === 'function'? s.map(v) : s)
    }

    // Set signal state directly bypassing propagation steps
    this.prime = function(v) {
      _mutate(v,v)
      return this
    }

    // Set or read the signal state value
    // This method produces state propagation throughout a connected circuit
    this.value = function(v) {
      if (arguments.length) { return _runToState(v,0,_bindEach) }
      return _state
    }

    // TODO - remove after refactor
    this.step = _next

    // An active signal will propagate state
    // An inactive signal will prevent state propagation
    this.active = function(reset) {
      if (arguments.length) {
        if (!reset) {_reset.push(_active), _active = false }
        else        {_active = !_reset.length || _reset.pop() }
      }
      return !!_active
    }

    // Return to inactive pristine (or v) state after propagation
    this.pulse = function(v){
      _pulse = v
      return this
    }

    // Establish the diff function used when this signal mutates state
    this.diff = function(diff) {
      _diff = diff
      return this
    }

    // Map the current signal state onto a new state and propagate
    // The function will be called in signal context
    // can halt propagation by returning undefined - retain current state (finally(s) not invoked)
    // can cancel propagation by returning Circus.FALSE - revert to previous state (finally(s) invoked)
    // Note that to map state onto undefined the pseudo value Circus.UNDEFINED must be returned
    this.map = function(f) {
      var _b = f.state===BEFORE, _f = _functor(_b && f.value || f)
      _b? _steps.unshift(_f) : _steps.splice(_step,0,_f)
      _step++
      return this
    }

    // create an I/O channel where 2 signals share state and flow in i -> o order
    // Optionally:
    // - take behaviour
    this.channel = function(io,take) {
      var split = extend({}, this, {constructor: _Signal})
      var map = function(f) {
        var _b = f.state===BEFORE, _f = _functor(_b && f.value || f)
        _b? _steps.splice(_step,0,_f) : _steps.push(_f)
        return this
      }
      _identity(split)
      // return split as after / before, with step ownership resolved
      _after = !io || io===Circus.after
      if (_after? !!take : !take) _step=0
      if (_after) split.map = map; else this.map = map
      return split
    }

    // convenient compose functor that maps from left to right
    this.flow = function(){
      var args = [].slice.call(arguments)
      for (var i=0; i<args.length; i++) {
        this.map(args[i])
      }
      return this
    }

    // Bind the signal
    // - lift a value into the signal
    // - return a value from the signal
    this.bind = function(f) {
      var __b = _bindEach
      _bindEach = function(step,args) {
        var n = function() {
          return __b(step, arguments)
        }
        return f.call(_ctx, n, args)
      }
      return this
    }

    // finally functions are executed in FILO order after all step functions regardless of state
    this.finally = function(f) {
      var fifo = f.state===BEFORE, _f = _bind(fifo && f.value || f)
      if (Circus.isSignal(_f)) {
        var fs=_f
        _f = function(v) {
          fs.value(v)
        }
      }
      _finallys[fifo? 'unshift' : 'push'](_f)
      return this
    }

    this.pure = function(diff) {
      _pure = diff!==false
      if (typeof diff === 'function') _diff = diff
      return this
    }

    this.error = function() {
      if (_fail) {
        var v = _fail.value
        _fail = false
        return v || true
      }
      return ''
    }

    // Tap the current signal state value
    // The function will be called in signal context
    this.tap = function(f) {
      return this.map(function(v){
        f.apply(this,arguments)
        return v===undefined? Circus.UNDEFINED : v
      })
    }

    // Extend a signal with custom step functions either through an
    // object graph, or a context bound function that returns an object graph
    // Chainable step functions need to return the context.
    this.extend = function(ext) {
      ext = typeof ext==='function'? ext(this) : ext
      return extend(this,ext)
    }

    return this
  }

  // constructor
  _proto = extend({}, extensions)
  _proto.constructor = _Signal
  Signal.prototype = _proto
}

Circus.fail = function(v) {if (!(this instanceof Circus.fail)) return new Circus.fail(v); this.value=v}

// static
Circus.TRUE =  Object.freeze({state:FSTATE, value:true})
Circus.FALSE =  Object.freeze({state:FSTATE, value:false})
Circus.NULL = Object.freeze({state:FSTATE, value:null})
Circus.UNDEFINED = Object.freeze({state:FSTATE, value:undefined})
Circus.ID = Object.freeze({state:FSTATE, value:undefined})

Circus.isSignal = function(s) {
  return s && s.constructor === _Signal
}

Circus.extend = function(ext) {
  extend(extensions,ext)
}

var _fnArgs = /function\s.*?\(([^)]*)\)/
Circus.isAsync = function(f){
  return f.length && f.toString().match(_fnArgs)[1].indexOf('next')>0
}

Circus.after = function(f) {
  return {state:AFTER, value:f}
}

Circus.before = function(f) {
  return {state:BEFORE, value:f}
}

return Circus

})()

if (typeof module != "undefined" && module !== null && module.exports) module.exports = Circus;
else if (typeof define == "function" && define.amd) define(function() {return Circus});
