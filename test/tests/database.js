module.exports = (function(Nodal) {

  "use strict";

  let expect = require('chai').expect;

  describe('Nodal.Database', function() {

    let db = new Nodal.Database();
    let myTable = {
      table: 'test_objects',
      columns: [
        {name: 'id', type: 'serial'},
        {name: 'test', type: 'string'},
        {name: 'created_at', type: 'datetime'}
      ]
    };

    after(function(done) {

      db.close(function() {
        done();
      });

    });

    describe('#connect', function() {

      it('should connect to my.Config database "main"', function() {

        expect(db.connect(Nodal.my.Config.db.main)).to.equal(true);

      });

    });

    describe('#query', function() {

      it('should throw an error if no params given', function() {

        let e = null;

        try {
          db.query();
        } catch(err) {
          e = err;
        }

        expect(e).to.not.equal(null);

      });

      it('should throw an error if params not an array', function() {

        let e = null;

        try {
          db.query('SELECT 1', true, function() {});
        } catch(err) {
          e = err;
        }

        expect(e).to.not.equal(null);

      });

      it('should throw an error if callback not a function', function() {

        let e = null;

        try {
          db.query('SELECT 1', [], true);
        } catch(err) {
          e = err;
        }

        expect(e).to.not.equal(null);

      });

      it('should run a basic SELECT query', function(done) {

        db.query('SELECT 1 AS __num__', [], function(err, result) {

          expect(err).to.equal(null);
          expect(result.rows[0].__num__).to.equal(1);

          done();

        });

      });

    });

    describe('#adapter', function() {

      it('should be able to create a table', function(done) {

        db.transaction(
          db.adapter.generateCreateTableQuery(myTable.table, myTable.columns),
          function(err, result) {
            expect(err).to.equal(null);
            done();
          }
        );

      });

      it('should be able to drop a table', function(done) {

        db.query(
          db.adapter.generateDropTableQuery(myTable.table),
          [],
          function(err, result) {
            expect(err).to.equal(null);
            done();
          }
        );

      });

    });

  });

});
